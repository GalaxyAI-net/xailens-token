/**
 * XAILENS Revoke Authorities Script
 *
 * Permanently revokes authorities on the XAILENS mint:
 *   --mint      revoke the mint authority (fixed 500M supply, irreversible)
 *   --metadata  revoke the Token-2022 metadata update authority (name,
 *               symbol and URI become immutable, irreversible)
 *
 * Without flags both are revoked. The freeze authority is never set by
 * scripts/setup-metadata.ts, so there is nothing to revoke there; the
 * script verifies and reports it.
 *
 * THIS IS IRREVERSIBLE. The script requires an explicit "yes" from stdin.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - Path to deployer keypair JSON
 *   XAILENS_MINT            - Mint address (can also pass as CLI arg)
 *
 * Usage:
 *   npx tsx scripts/revoke-authority.ts <mint-address> [--mint] [--metadata]
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  setAuthority,
  AuthorityType,
  getMint,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createUpdateAuthorityInstruction } from "@solana/spl-token-metadata";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair(keypairPath: string): Keypair {
  const resolved = keypairPath.startsWith("~")
    ? path.join(os.homedir(), keypairPath.slice(1))
    : path.resolve(keypairPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair file not found: ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function explorerUrl(address: string, cluster: string): string {
  const base = "https://explorer.solana.com/address/";
  const params = cluster.includes("devnet") ? "?cluster=devnet" : "";
  return `${base}${address}${params}`;
}

function explorerTxUrl(sig: string, cluster: string): string {
  const base = "https://explorer.solana.com/tx/";
  const params = cluster.includes("devnet") ? "?cluster=devnet" : "";
  return `${base}${sig}${params}`;
}

function sanitizeRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    const hasPath = u.pathname !== '/';
    const hasQuery = u.search !== '';
    if (hasPath || hasQuery) {
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/<redacted>`;
    }
    return url;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Prompts the user via stdin and returns their answer.
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- Resolve mint address ----------------------------------------------
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const mintArg = args.find((a) => !a.startsWith("--"));
  const mintStr = mintArg || process.env.XAILENS_MINT;
  const doMint = flags.size === 0 || flags.has("--mint");
  const doMetadata = flags.size === 0 || flags.has("--metadata");

  if (!mintStr) {
    console.error(
      "Error: Provide the mint address as a CLI argument or set XAILENS_MINT."
    );
    console.error("Usage: npx tsx scripts/revoke-authority.ts [mint-address]");
    process.exit(1);
  }

  const mint = new PublicKey(mintStr);

  // ---- Connection --------------------------------------------------------
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = rpcUrl.includes("devnet")
    ? "devnet"
    : rpcUrl.includes("mainnet")
    ? "mainnet-beta"
    : rpcUrl;

  console.log("=".repeat(60));
  console.log("XAILENS - Revoke Authorities");
  console.log("=".repeat(60));
  console.log(`RPC          : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Cluster      : ${cluster}`);
  console.log(`Mint         : ${mint.toBase58()}`);
  console.log();

  // ---- Load keypair ------------------------------------------------------
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json";
  const authority = loadKeypair(keypairPath);
  console.log(`Authority    : ${authority.publicKey.toBase58()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(
    `SOL Balance  : ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
  );
  console.log();

  // ---- Fetch current state ---------------------------------------------
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) throw new Error("mint account not found on this cluster");
  const tokenProgram = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const isToken2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID);
  console.log(`Token program      : ${isToken2022 ? "Token-2022" : "legacy SPL (Metaplex metadata is immutable from creation; nothing to revoke there)"}`);
  const mintInfo = await getMint(connection, mint, "confirmed", tokenProgram);
  const md = isToken2022 ? await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null) : null;
  const mdAuthority = md?.updateAuthority && !md.updateAuthority.equals(PublicKey.default) ? md.updateAuthority : null;
  const DECIMALS = mintInfo.decimals;

  console.log(`Supply             : ${(Number(mintInfo.supply) / 10 ** DECIMALS).toLocaleString()} XAILENS`);
  console.log(`Mint authority     : ${mintInfo.mintAuthority?.toBase58() ?? "REVOKED"}`);
  console.log(`Freeze authority   : ${mintInfo.freezeAuthority?.toBase58() ?? "NONE"}`);
  console.log(`Metadata authority : ${mdAuthority?.toBase58() ?? (md ? "REVOKED" : "no metadata extension")}`);
  console.log();

  if (mintInfo.freezeAuthority) {
    console.error("ERROR: a freeze authority is set. XAILENS must never have one. Revoke it manually and re-run.");
    process.exit(1);
  }

  const actions: string[] = [];
  if (doMint) {
    if (!mintInfo.mintAuthority) {
      console.log("Mint authority already revoked.");
    } else if (!mintInfo.mintAuthority.equals(authority.publicKey)) {
      console.error("ERROR: loaded keypair is not the mint authority.");
      process.exit(1);
    } else {
      actions.push("mint");
    }
  }
  if (doMetadata) {
    if (!isToken2022) {
      // handled by the message above
    } else if (!md) {
      console.log("No metadata extension on this mint; nothing to revoke.");
    } else if (!mdAuthority) {
      console.log("Metadata update authority already revoked.");
    } else if (!mdAuthority.equals(authority.publicKey)) {
      console.error("ERROR: loaded keypair is not the metadata update authority.");
      process.exit(1);
    } else {
      actions.push("metadata");
    }
  }
  if (actions.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // ---- Confirmation prompt -----------------------------------------------
  console.log("!".repeat(60));
  console.log("WARNING: THIS ACTION IS IRREVERSIBLE");
  console.log("!".repeat(60));
  console.log(`Revoking: ${actions.join(" + ")} authority on ${mint.toBase58()}`);
  const answer = await prompt('Type "yes" to confirm (anything else cancels): ');
  if (answer.toLowerCase() !== "yes") {
    console.log("Aborted. Nothing was revoked.");
    return;
  }

  if (actions.includes("mint")) {
    const sig = await setAuthority(connection, authority, mint, authority, AuthorityType.MintTokens, null, [], { commitment: "confirmed" }, tokenProgram);
    console.log(`Mint authority revoked   : ${explorerTxUrl(sig, cluster)}`);
  }
  if (actions.includes("metadata")) {
    const ix = createUpdateAuthorityInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      oldAuthority: authority.publicKey,
      newAuthority: null,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority], { commitment: "confirmed" });
    console.log(`Metadata authority revoked: ${explorerTxUrl(sig, cluster)}`);
  }

  // ---- Verify --------------------------------------------------------------
  const after = await getMint(connection, mint, "confirmed", tokenProgram);
  const mdAfter = isToken2022 ? await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null) : null;
  const mdAuthAfter = mdAfter?.updateAuthority && !mdAfter.updateAuthority.equals(PublicKey.default) ? mdAfter.updateAuthority : null;
  console.log();
  console.log(`Mint authority     : ${after.mintAuthority?.toBase58() ?? "REVOKED"}`);
  console.log(`Freeze authority   : ${after.freezeAuthority?.toBase58() ?? "NONE"}`);
  console.log(`Metadata authority : ${isToken2022 ? (mdAuthAfter?.toBase58() ?? "REVOKED") : "n/a (legacy SPL, Metaplex metadata immutable)"}`);
  console.log(`Explorer           : ${explorerUrl(mint.toBase58(), cluster)}`);
  if ((actions.includes("mint") && after.mintAuthority) || (actions.includes("metadata") && mdAuthAfter)) {
    console.error("ERROR: an authority is still set after the transaction.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
