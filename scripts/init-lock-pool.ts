/**
 * Initialize the xailens-lock pool.
 *
 * Must be signed by the program's upgrade authority (the deployer right after
 * `anchor deploy`). Sets the decided thresholds and cooldown. Idempotent:
 * exits if the pool for this mint already exists (one pool per mint).
 *
 * TGE order: create mint (freeze = null) -> mint 500M -> distribute ->
 * revoke mint authority -> this script. Preflight refuses a mint with the
 * wrong decimals or a freeze authority, and on mainnet (or an unrecognised
 * RPC) a mint whose mint authority is still set. The token program is read
 * from the mint's owner, never from configuration.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   SOLANA_CLUSTER          - mainnet-beta | devnet | localnet; required when the RPC URL does not reveal the cluster
 *   DEPLOYER_KEYPAIR_PATH   - upgrade authority keypair (default ~/.config/solana/id.json)
 *   XAILENS_MINT            - mint address
 *   LOCK_PROGRAM_ID         - program id (default: from the IDL in sdk/src/idl)
 *
 * Usage:
 *   npx tsx scripts/init-lock-pool.ts
 */
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";
import * as os from "os";
import idl from "../sdk/src/idl/xailens_lock.json";
import type { XailensLock } from "../sdk/src/idl/xailens_lock";
import { checkMintForPool, resolveCluster, needsConfirmation, sanitizeRpcUrl, tokenProgramFromOwner } from "./lib/preflight";

const DECIMALS = 6;

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}
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
  const cluster = resolveCluster(rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const authority = loadKeypair(process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json");
  const mintStr = process.env.XAILENS_MINT;
  if (!mintStr) throw new Error("Set XAILENS_MINT");
  const mint = new PublicKey(mintStr);
  const programId = new PublicKey(process.env.LOCK_PROGRAM_ID || idl.address);

  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) throw new Error("mint not found on this cluster");
  const tokenProgram = tokenProgramFromOwner(mintAccount.owner);
  const mintInfo = await getMint(connection, mint, "confirmed", tokenProgram);
  const check = checkMintForPool(mintInfo, cluster);

  const provider = new AnchorProvider(connection, new Wallet(authority), { commitment: "confirmed" });
  const program = new Program<XailensLock>({ ...(idl as XailensLock), address: programId.toBase58() }, provider);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool"), mint.toBuffer()], programId); // one pool per mint
  const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_UPGRADEABLE_LOADER);

  console.log("xailens-lock initialize");
  console.log(`RPC       : ${sanitizeRpcUrl(rpcUrl)} (${cluster})`);
  console.log(`Program   : ${programId.toBase58()}`);
  console.log(`Pool PDA  : ${pool.toBase58()}`);
  console.log(`Mint      : ${mint.toBase58()} (${tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "legacy SPL"})`);
  console.log(`Authority : ${authority.publicKey.toBase58()}`);
  for (const w of check.warnings) console.log(`WARNING   : ${w}`);
  if (check.errors.length > 0) {
    for (const e of check.errors) console.error(`ERROR     : ${e}`);
    throw new Error("mint preflight failed; nothing was sent");
  }

  const existing = await program.account.lockPool.fetchNullable(pool);
  if (existing) {
    console.log("Pool already initialized. authority =", existing.authority.toBase58());
    return;
  }

  if (needsConfirmation(cluster)) {
    const answer = await prompt(`Cluster is ${cluster}. Type "yes" to initialize the pool: `);
    if (answer.toLowerCase() !== "yes") {
      console.log("Aborted. Nothing was sent.");
      return;
    }
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
