/**
 * XAILENS Token Distribution Script
 *
 * Moves the freshly minted supply from the deployer wallet to the holding
 * wallets of each allocation bucket. Every destination must be a Squads
 * multisig vault, EXCEPT buckets that are vested: those stay in the
 * deployer wallet because Streamflow vesting streams are created *by the
 * sender* (the deployer signs `createStream` from its own token account).
 * Sending vested buckets to a "vesting contract address" is not how
 * Streamflow works and would simply park tokens in an unlocked wallet.
 *
 * The allocation table is read from config/allocations.json so the numbers
 * live in one place next to docs/TOKENOMICS.md. The script refuses to run
 * while any destination is still a placeholder or while the table does
 * not sum to the total supply.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - Path to deployer keypair JSON
 *   XAILENS_MINT            - Mint address of the XAILENS token
 *
 * Usage:
 *   npx tsx scripts/distribute.ts                # execute distribution
 *   npx tsx scripts/distribute.ts --dry-run      # preview only
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECIMALS = 6;
const ONE_TOKEN = BigInt(10 ** DECIMALS);

/**
 * Allocation table.
 *
 * IMPORTANT: Replace the placeholder wallet addresses below with real
 * addresses before running on mainnet. The placeholder addresses are
 * deterministic devnet-safe keypairs that you control for testing.
 *
 * "Community Donations" stays in the deployer wallet, so its destination
 * is set to null.
 */
interface Allocation {
  label: string;
  tokens: number; // in whole tokens (not raw)
  /** base58 Squads vault, or null = stays in deployer (vested via Streamflow from here) */
  destination: string | null;
  description: string;
}

interface AllocationFile {
  totalSupply: number;
  allocations: Allocation[];
}

const ALLOCATION_FILE = process.env.ALLOCATIONS_CONFIG || path.resolve(__dirname, "..", "config", "allocations.json");
const { totalSupply: TOTAL_SUPPLY, allocations: ALLOCATIONS }: AllocationFile = JSON.parse(
  fs.readFileSync(ALLOCATION_FILE, "utf-8"),
);

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

function formatTokens(amount: number): string {
  return amount.toLocaleString("en-US");
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // ---- Connection --------------------------------------------------------
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = rpcUrl.includes("devnet")
    ? "devnet"
    : rpcUrl.includes("mainnet")
    ? "mainnet-beta"
    : rpcUrl;

  console.log("=".repeat(64));
  console.log(
    dryRun
      ? "XAILENS Token Distribution (DRY RUN)"
      : "XAILENS Token Distribution"
  );
  console.log("=".repeat(64));
  if (rpcUrl.includes('mainnet')) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => {
      rl.question('\n\u26a0\ufe0f  You are targeting MAINNET. Type "yes" to continue: ', resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  console.log(`RPC       : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Cluster   : ${cluster}`);
  if (dryRun) {
    console.log(`Mode      : DRY RUN - no transactions will be sent`);
  }
  console.log();

  // ---- Deployer ----------------------------------------------------------
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json";
  const deployer = loadKeypair(keypairPath);
  console.log(`Deployer  : ${deployer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(deployer.publicKey);
  console.log(
    `SOL Bal.  : ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
  );
  console.log();

  // ---- Mint address ------------------------------------------------------
  const mintStr = process.env.XAILENS_MINT;
  if (!mintStr) {
    console.error(
      "Error: Set XAILENS_MINT environment variable to the token mint address."
    );
    process.exit(1);
  }
  const mint = new PublicKey(mintStr);
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) {
    console.error("Error: mint account not found on this cluster.");
    process.exit(1);
  }
  const tokenProgram = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  console.log(`Token prg : ${tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "legacy SPL"}`);
  console.log(`Mint      : ${mint.toBase58()}`);

  // ---- Placeholder address detection --------------------------------------
  const PLACEHOLDER_PATTERN = /(1{10,}$|^TODO|^<)/;
  const sum = ALLOCATIONS.reduce((a, b) => a + b.tokens, 0);
  if (sum !== TOTAL_SUPPLY) {
    console.error(`\nFATAL: allocations sum to ${sum.toLocaleString()} but total supply is ${TOTAL_SUPPLY.toLocaleString()}.`);
    process.exit(1);
  }
  for (const alloc of ALLOCATIONS) {
    if (alloc.destination && PLACEHOLDER_PATTERN.test(alloc.destination)) {
      console.error(`\nFATAL: "${alloc.label}" still has a placeholder address: ${alloc.destination}`);
      console.error('Replace all placeholder addresses before running distribution.');
      process.exit(1);
    }
  }

  // ---- Deployer ATA & balance check --------------------------------------
  const deployerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    mint,
    deployer.publicKey,
    false,
    "confirmed",
    undefined,
    tokenProgram
  );
  const deployerBalanceRaw = deployerAta.amount;
  const deployerBalance = Number(deployerBalanceRaw) / 10 ** DECIMALS;
  console.log(
    `Deployer ATA Balance: ${formatTokens(deployerBalance)} XAILENS`
  );
  console.log();

  // ---- Validate allocations sum to 500M ----------------------------------
  const totalAllocated = ALLOCATIONS.reduce((s, a) => s + a.tokens, 0);
  console.log(
    `Total allocation: ${formatTokens(totalAllocated)} XAILENS (should be 500,000,000)`
  );
  if (totalAllocated !== 500_000_000) {
    console.error(
      `ERROR: Allocations sum to ${totalAllocated}, expected 500,000,000`
    );
    process.exit(1);
  }

  // Check that deployer has enough to cover transfers (excluding the
  // "Community Donations" bucket which stays in deployer).
  const transferTotal = ALLOCATIONS.filter((a) => a.destination !== null).reduce(
    (s, a) => s + a.tokens,
    0
  );
  const transferTotalRaw = BigInt(transferTotal) * ONE_TOKEN;
  if (deployerBalanceRaw < transferTotalRaw) {
    console.error(
      `ERROR: Deployer only has ${formatTokens(deployerBalance)} XAILENS ` +
        `but needs ${formatTokens(transferTotal)} for transfers.`
    );
    process.exit(1);
  }
  console.log(
    `Tokens to transfer: ${formatTokens(transferTotal)} XAILENS`
  );
  console.log();

  // ---- Print allocation table --------------------------------------------
  console.log("-".repeat(64));
  console.log(
    "Label".padEnd(24) +
      "Tokens".padStart(18) +
      "  " +
      "Destination"
  );
  console.log("-".repeat(64));
  for (const alloc of ALLOCATIONS) {
    const dest =
      alloc.destination === null
        ? "(deployer - no transfer)"
        : alloc.destination.slice(0, 20) + "...";
    console.log(
      alloc.label.padEnd(24) +
        formatTokens(alloc.tokens).padStart(18) +
        "  " +
        dest
    );
  }
  console.log("-".repeat(64));
  console.log();

  // ---- Execute distributions ---------------------------------------------
  let successCount = 0;
  let skipCount = 0;

  for (const alloc of ALLOCATIONS) {
    console.log(`[${alloc.label}]`);
    console.log(`  ${alloc.description}`);

    if (alloc.destination === null) {
      console.log(
        `  SKIP: ${formatTokens(alloc.tokens)} XAILENS remain in deployer wallet.`
      );
      console.log();
      skipCount++;
      continue;
    }

    const rawAmount = BigInt(alloc.tokens) * ONE_TOKEN;
    let destinationPubkey: PublicKey;
    try {
      destinationPubkey = new PublicKey(alloc.destination);
    } catch {
      console.error(
        `  ERROR: Invalid destination address "${alloc.destination}". Skipping.`
      );
      console.log();
      continue;
    }

    if (dryRun) {
      console.log(
        `  DRY RUN: Would transfer ${formatTokens(alloc.tokens)} XAILENS ` +
          `to ${destinationPubkey.toBase58()}`
      );
      console.log(
        `  DRY RUN: Would create ATA for ${destinationPubkey.toBase58()} if needed.`
      );
      console.log();
      successCount++;
      continue;
    }

    try {
      // Create destination ATA if it does not exist
      console.log(`  Creating/finding ATA for ${destinationPubkey.toBase58()}...`);
      const destAta = await getOrCreateAssociatedTokenAccount(
        connection,
        deployer, // payer for ATA creation
        mint,
        destinationPubkey,
        true, // allowOwnerOffCurve (for PDAs / multisig)
        "confirmed",
        undefined,
        tokenProgram
      );
      console.log(`  Dest ATA : ${destAta.address.toBase58()}`);

      // Transfer tokens
      console.log(
        `  Transferring ${formatTokens(alloc.tokens)} XAILENS...`
      );
      const sig = await transfer(
        connection,
        deployer,
        deployerAta.address,
        destAta.address,
        deployer,
        rawAmount,
        [],
        { commitment: "confirmed" },
        tokenProgram
      );
      console.log(`  Tx       : ${sig}`);

      // Verify
      const destInfo = await getAccount(
        connection,
        destAta.address,
        "confirmed",
        tokenProgram
      );
      console.log(
        `  Verified : ${(Number(destInfo.amount) / 10 ** DECIMALS).toLocaleString()} XAILENS`
      );
      console.log();
      successCount++;
    } catch (err) {
      console.error(`  FAILED: ${err}`);
      console.log();
    }
  }

  // ---- Summary -----------------------------------------------------------
  console.log("=".repeat(64));
  console.log("Distribution Summary");
  console.log("=".repeat(64));
  console.log(`Successful transfers : ${successCount}`);
  console.log(`Skipped (in deployer): ${skipCount}`);
  console.log(`Total allocations    : ${ALLOCATIONS.length}`);

  if (dryRun) {
    console.log();
    console.log("This was a DRY RUN. No tokens were actually transferred.");
    console.log("Remove --dry-run to execute for real.");
  } else {
    // Show final deployer balance
    const finalAta = await getAccount(
      connection,
      deployerAta.address,
      "confirmed",
      tokenProgram
    );
    console.log(
      `Deployer remaining   : ${(
        Number(finalAta.amount) / 10 ** DECIMALS
      ).toLocaleString()} XAILENS`
    );
  }
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
