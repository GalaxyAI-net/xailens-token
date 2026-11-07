/**
 * Lock demo / smoke test against a deployed xailens-lock pool.
 *
 * Locks `amount` XAILENS (UI units, default 100000) from the keypair's wallet
 * if it has no lock yet, then prints the lock account and the entitlement
 * the SDK would grant now, in 25 days and in 180 days. Read-only when a lock
 * already exists. Devnet or localnet only: refuses mainnet and unrecognised
 * RPC URLs.
 *
 * Environment variables:
 *   SOLANA_RPC_URL, DEPLOYER_KEYPAIR_PATH, XAILENS_MINT, LOCK_PROGRAM_ID
 *
 * Usage:
 *   npx tsx scripts/lock-demo.ts [amount]
 */
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl, sendAndConfirmTransaction } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LockClient, getXailensBalance, getXailensMintInfo } from "../sdk/src/index.js";
import { resolveCluster, sanitizeRpcUrl, tokenProgramFromOwner } from "./lib/preflight";

function loadKeypair(p: string): Keypair {
  const resolved = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const cluster = resolveCluster(rpcUrl);
  if (cluster !== "devnet" && cluster !== "localnet") {
    throw new Error(`lock-demo runs on devnet or localnet only (got ${cluster}: ${sanitizeRpcUrl(rpcUrl)})`);
  }
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json");
  if (!process.env.XAILENS_MINT || !process.env.LOCK_PROGRAM_ID) throw new Error("Set XAILENS_MINT and LOCK_PROGRAM_ID");
  const mint = new PublicKey(process.env.XAILENS_MINT);
  const programId = new PublicKey(process.env.LOCK_PROGRAM_ID);
  const amount = process.argv[2] || "100000";
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) throw new Error("mint not found on this cluster");
  const tokenProgram = tokenProgramFromOwner(mintAccount.owner);

  console.log("wallet        :", payer.publicKey.toBase58());
  console.log("balance before:", await getXailensBalance(connection, payer.publicKey, mint, tokenProgram));
  const info = await getXailensMintInfo(connection, mint, tokenProgram);
  console.log("mint authority:", info.mintAuthority?.toBase58() ?? "REVOKED", "| freeze:", info.freezeAuthority?.toBase58() ?? "NONE", "| supply:", info.supply.toString());

  const client = new LockClient(connection, { mint, wallet: new Wallet(payer), programId });
  const pool = await client.getPool();
  console.log("pool          :", client.poolAddress.toBase58(), "| thresholds (raw):", pool.discountThreshold.toString(), pool.founderThreshold.toString(), pool.votingThreshold.toString(), "| paused:", pool.paused);

  if (!(await client.getLockAccount(payer.publicKey))) {
    const ix = await client.buildLockIx(payer.publicKey, amount);
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: "confirmed" });
    console.log(`locked ${amount}  :`, sig);
  }
  const acc = await client.getLockAccount(payer.publicKey);
  console.log("lock account  :", client.lockAccountAddress(payer.publicKey).toBase58(), { amount: acc!.amount.toString(), discountSince: acc!.discountSince, founderSince: acc!.founderSince, votingSince: acc!.votingSince });
  const now = Math.floor(Date.now() / 1000);
  console.log("eligible now  :", await client.getEligibility(payer.publicKey, now));
  console.log("eligible +25d :", await client.getEligibility(payer.publicKey, now + 25 * 86400));
  console.log("eligible +180d:", await client.getEligibility(payer.publicKey, now + 180 * 86400));
  console.log("balance after :", await getXailensBalance(connection, payer.publicKey, mint, tokenProgram));
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
