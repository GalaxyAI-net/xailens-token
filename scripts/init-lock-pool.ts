/**
 * Initialize the xailens-lock pool.
 *
 * Must be signed by the program's upgrade authority (the deployer right after
 * `anchor deploy`). Sets the decided thresholds and cooldown. Idempotent:
 * exits if the pool already exists.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - upgrade authority keypair (default ~/.config/solana/id.json)
 *   XAILENS_MINT            - mint address
 *   LOCK_PROGRAM_ID         - program id (default: from the IDL in sdk/src/idl)
 *   XAILENS_TOKEN_PROGRAM   - "token2022" or "legacy" (default legacy)
 *
 * Usage:
 *   npx tsx scripts/init-lock-pool.ts
 */
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import idl from "../sdk/src/idl/xailens_lock.json";
import type { XailensLock } from "../sdk/src/idl/xailens_lock";

const DECIMALS = 6;
const raw = (ui: number) => new BN(ui).mul(new BN(10 ** DECIMALS));

// Decided 2026-10-28 (docs/TOKENOMICS.md section 7)
const COOLDOWN_SECONDS = 7 * 24 * 3600;
const DISCOUNT_THRESHOLD = 10_000;
const FOUNDER_THRESHOLD = 100_000;
const VOTING_THRESHOLD = 100_000;

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function loadKeypair(p: string): Keypair {
  const resolved = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const authority = loadKeypair(process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json");
  const mintStr = process.env.XAILENS_MINT;
  if (!mintStr) throw new Error("Set XAILENS_MINT");
  const mint = new PublicKey(mintStr);
  const programId = new PublicKey(process.env.LOCK_PROGRAM_ID || idl.address);
  const tokenProgram = process.env.XAILENS_TOKEN_PROGRAM === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) throw new Error("mint not found on this cluster");
  if (!mintAccount.owner.equals(tokenProgram)) {
    throw new Error(`mint is owned by ${mintAccount.owner.toBase58()}, but XAILENS_TOKEN_PROGRAM selects ${tokenProgram.toBase58()}`);
  }

  const provider = new AnchorProvider(connection, new Wallet(authority), { commitment: "confirmed" });
  const program = new Program<XailensLock>({ ...(idl as XailensLock), address: programId.toBase58() }, provider);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool")], programId);
  const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_UPGRADEABLE_LOADER);

  console.log("xailens-lock initialize");
  console.log(`Program   : ${programId.toBase58()}`);
  console.log(`Pool PDA  : ${pool.toBase58()}`);
  console.log(`Mint      : ${mint.toBase58()} (${tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "legacy SPL"})`);
  console.log(`Authority : ${authority.publicKey.toBase58()}`);

  const existing = await program.account.lockPool.fetchNullable(pool);
  if (existing) {
    console.log("Pool already initialized. authority =", existing.authority.toBase58());
    return;
  }

  const sig = await program.methods
    .initialize({
      cooldownPeriod: new BN(COOLDOWN_SECONDS),
      discountThreshold: raw(DISCOUNT_THRESHOLD),
      founderThreshold: raw(FOUNDER_THRESHOLD),
      votingThreshold: raw(VOTING_THRESHOLD),
    })
    .accountsPartial({ authority: authority.publicKey, mint, program: programId, programData, tokenProgram })
    .rpc();
  console.log(`Init tx   : ${sig}`);

  const p = await program.account.lockPool.fetch(pool);
  console.log(`Vault     : ${p.vault.toBase58()}`);
  console.log(`Cooldown  : ${p.cooldownPeriod.toNumber()} s`);
  console.log(`Thresholds: discount ${p.discountThreshold.toString()} / founder ${p.founderThreshold.toString()} / voting ${p.votingThreshold.toString()} (raw)`);
  console.log("Next: propose_authority to the Squads vault, then accept from the vault.");
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
