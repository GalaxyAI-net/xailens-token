/**
 * XAILENS legacy SPL mint creation (fallback path).
 *
 * Use this instead of `setup-metadata.ts create` ONLY when the launch venue
 * (launchpad claim contract, vesting provider, exchange) has not confirmed
 * Token-2022 support. Creates a classic SPL Token mint with Metaplex
 * metadata that is IMMUTABLE from creation (`isMutable = false`), mints the
 * fixed supply to the deployer ATA, and sets no freeze authority.
 *
 * After this script: run `revoke-authority.ts <mint>` to revoke the mint
 * authority. There is no metadata authority to revoke on this path.
 *
 * Migration to Token-2022 is on the roadmap (docs/TOKENOMICS.md, section 1).
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - Path to deployer keypair JSON
 *   TOKEN_URI               - Off-chain metadata JSON URL (default below)
 *
 * Usage:
 *   npx tsx scripts/create-mint-legacy.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  getMint,
} from "@solana/spl-token";
import {
  PROGRAM_ID as METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  Metadata,
} from "@metaplex-foundation/mpl-token-metadata";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const DECIMALS = 6;
const TOTAL_SUPPLY = 500_000_000;
const RAW_SUPPLY = BigInt(TOTAL_SUPPLY) * BigInt(10 ** DECIMALS);
const TOKEN_NAME = "XAILENS";
const TOKEN_SYMBOL = "XAILENS";
const TOKEN_URI = process.env.TOKEN_URI || "https://xailens.com/token-metadata.json";

function loadKeypair(keypairPath: string): Keypair {
  const resolved = keypairPath.startsWith("~") ? path.join(os.homedir(), keypairPath.slice(1)) : path.resolve(keypairPath);
  if (!fs.existsSync(resolved)) throw new Error(`Keypair file not found: ${resolved}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

function sanitizeRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname !== "/" || u.search !== "" ? `${u.protocol}//${u.host}/<redacted>` : url;
  } catch {
    return "<invalid-url>";
  }
}

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}

export function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = rpcUrl.includes("mainnet") ? "mainnet-beta" : rpcUrl.includes("devnet") ? "devnet" : "custom";

  console.log("XAILENS legacy SPL mint (fallback path)");
  console.log(`RPC     : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Cluster : ${cluster}`);
  if (cluster === "mainnet-beta") {
    const a = await prompt('You are targeting MAINNET. Type "yes" to continue: ');
    if (a.toLowerCase() !== "yes") { console.log("Aborted."); return; }
  }

  const payer = loadKeypair(process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json");
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
  console.log(`Deployer: ${payer.publicKey.toBase58()}`);
  console.log(`Mint    : ${mint.toBase58()}`);

  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    // mint authority = deployer (revoked right after), freeze authority = none
    createInitializeMint2Instruction(mint, DECIMALS, payer.publicKey, null, TOKEN_PROGRAM_ID),
    createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda(mint),
        mint,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: TOKEN_NAME,
            symbol: TOKEN_SYMBOL,
            uri: TOKEN_URI,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: false, // immutable from day one: no metadata authority to revoke later
          collectionDetails: null,
        },
      },
    ),
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, payer.publicKey, mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, ata, payer.publicKey, RAW_SUPPLY, [], TOKEN_PROGRAM_ID),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair], { commitment: "confirmed" });
  console.log(`Create tx: ${sig}`);

  const info = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
  const md = await Metadata.fromAccountAddress(connection, metadataPda(mint), "confirmed");
  console.log(`Supply          : ${(Number(info.supply) / 10 ** DECIMALS).toLocaleString()} XAILENS`);
  console.log(`Mint authority  : ${info.mintAuthority?.toBase58() ?? "REVOKED"}  (revoke next with scripts/revoke-authority.ts)`);
  console.log(`Freeze authority: ${info.freezeAuthority?.toBase58() ?? "NONE"}`);
  console.log(`Metadata        : ${md.data.name.replace(/\0/g, "")} / ${md.data.symbol.replace(/\0/g, "")} / mutable=${md.isMutable}`);

  if (process.argv.includes("--revoke-now")) {
    const revoke = createSetAuthorityInstruction(mint, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID);
    const s2 = await sendAndConfirmTransaction(connection, new Transaction().add(revoke), [payer], { commitment: "confirmed" });
    console.log(`Mint authority revoked in ${s2}`);
  }
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
