/**
 * XAILENS authority verification report.
 *
 * Read-only. Prints what a launchpad or exchange reviewer checks first:
 * supply, mint authority, freeze authority, metadata update authority,
 * and (optionally) the lock program's pool authority and upgrade authority.
 *
 * Environment variables:
 *   SOLANA_RPC_URL   - RPC endpoint (default: devnet)
 *   XAILENS_MINT     - mint address (or pass as first CLI argument)
 *   LOCK_PROGRAM_ID  - optional, xailens-lock program id to inspect
 *
 * Usage:
 *   npx tsx scripts/verify-authorities.ts <mint>
 */
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getMint, getTokenMetadata, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID as METADATA_PROGRAM_ID, Metadata } from "@metaplex-foundation/mpl-token-metadata";

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function sanitizeRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname !== "/" || u.search !== "" ? `${u.protocol}//${u.host}/<redacted>` : url;
  } catch {
    return "<invalid-url>";
  }
}

function status(ok: boolean): string {
  return ok ? "OK  " : "WARN";
}

async function main(): Promise<void> {
  const mintStr = process.argv[2] || process.env.XAILENS_MINT;
  if (!mintStr) {
    console.error("Usage: npx tsx scripts/verify-authorities.ts <mint>  (or set XAILENS_MINT)");
    process.exit(1);
  }
  const mint = new PublicKey(mintStr);
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("XAILENS authority report");
  console.log(`RPC  : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Mint : ${mint.toBase58()}`);
  console.log();

  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) throw new Error("mint account not found on this cluster");
  const tokenProgram = mintAccount.owner;
  const isToken2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID);
  if (!isToken2022 && !tokenProgram.equals(TOKEN_PROGRAM_ID)) throw new Error(`unexpected mint owner ${tokenProgram.toBase58()}`);
  console.log(`[INFO] token program       : ${isToken2022 ? "Token-2022" : "legacy SPL (migration to Token-2022 on roadmap)"}`);

  const info = await getMint(connection, mint, "confirmed", tokenProgram);
  const supplyUi = Number(info.supply) / 10 ** info.decimals;
  console.log(`[${status(info.decimals === 6)}] decimals            : ${info.decimals}`);
  console.log(`[${status(supplyUi === 500_000_000)}] supply              : ${supplyUi.toLocaleString("en-US")}`);
  console.log(`[${status(info.mintAuthority === null)}] mint authority      : ${info.mintAuthority?.toBase58() ?? "REVOKED"}`);
  console.log(`[${status(info.freezeAuthority === null)}] freeze authority    : ${info.freezeAuthority?.toBase58() ?? "NONE"}`);

  if (isToken2022) {
    const md = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
    const mdAuth = md?.updateAuthority && !md.updateAuthority.equals(PublicKey.default) ? md.updateAuthority : null;
    console.log(`[${status(mdAuth === null)}] metadata authority  : ${mdAuth?.toBase58() ?? (md ? "REVOKED" : "no metadata extension")}`);
    if (md) console.log(`       name / symbol / uri : ${md.name} / ${md.symbol} / ${md.uri}`);
  } else {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID);
    const md = await Metadata.fromAccountAddress(connection, pda, "confirmed").catch(() => null);
    if (!md) {
      console.log("[WARN] metadata            : no Metaplex metadata account");
    } else {
      const clean = (v: string) => v.replace(/\0/g, "");
      console.log(`[${status(!md.isMutable)}] metadata mutable    : ${md.isMutable} (update authority ${md.updateAuthority.toBase58()})`);
      console.log(`       name / symbol / uri : ${clean(md.data.name)} / ${clean(md.data.symbol)} / ${clean(md.data.uri)}`);
    }
  }

  const programStr = process.env.LOCK_PROGRAM_ID;
  if (programStr) {
    const programId = new PublicKey(programStr);
    const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_UPGRADEABLE_LOADER);
    const acc = await connection.getAccountInfo(programData);
    console.log();
    console.log(`Lock program : ${programId.toBase58()}`);
    if (!acc) {
      console.log("[WARN] program data account not found (not deployed on this cluster?)");
    } else {
      // ProgramData layout: 4 bytes enum, 8 bytes slot, 1 byte option, 32 bytes authority
      const hasAuthority = acc.data[12] === 1;
      const authority = hasAuthority ? new PublicKey(acc.data.subarray(13, 45)) : null;
      console.log(`[${status(authority === null)}] upgrade authority   : ${authority?.toBase58() ?? "NONE (immutable)"}`);
      if (authority) {
        console.log("       Expect this to be a Squads multisig before TGE, or NONE after the audit.");
      }
    }
  }
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
