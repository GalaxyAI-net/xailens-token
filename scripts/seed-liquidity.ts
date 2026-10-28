/**
 * XAILENS Raydium Liquidity Pool Seeding Helper
 *
 * Pool type: Raydium CPMM (constant product, Token-2022 compatible, fungible
 * LP tokens that can be locked). Do NOT use AMM v4: it does not accept
 * Token-2022 mints. CLMM positions are NFTs and cannot be locked with the
 * usual LP lockers, so CPMM is the default for the launch pool.
 *
 * This script helps prepare for creating a XAILENS/USDC liquidity pool
 * on Raydium. Creating a Raydium AMM pool on-chain is complex (requires
 * multiple accounts, PDAs, and specific instruction ordering), so this
 * script serves as a calculation + guidance tool.
 *
 * What it does:
 *   1. Calculates the initial liquidity amounts at the target price
 *   2. Verifies wallet balances
 *   3. Prints step-by-step instructions for Raydium pool creation
 *   4. Optionally builds and sends the Raydium createPool instruction
 *      (if RAYDIUM_PROGRAM_ID is set and the user opts in)
 *
 * Raydium AMM Pool Creation Process:
 * -----------------------------------
 * Raydium's Concentrated Liquidity (CLMM) or standard AMM pools require:
 *   - An OpenBook (Serum) market for the token pair (for legacy AMM)
 *   - Sufficient SOL for rent-exempt accounts (~3-4 SOL for all PDAs)
 *   - Token A amount + Token B amount for initial liquidity
 *   - The initial price is determined by the ratio of token amounts
 *
 * For Raydium V4 AMM:
 *   1. Create an OpenBook market for XAILENS/USDC
 *   2. Call Raydium's createPool with the market ID
 *   3. Raydium creates LP tokens and vault accounts automatically
 *
 * For Raydium CLMM (concentrated liquidity):
 *   1. Create pool with initial price and fee tier
 *   2. Add liquidity at a specific price range
 *   3. No OpenBook market required
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - Path to deployer keypair JSON
 *   XAILENS_MINT            - XAILENS token mint address
 *   RAYDIUM_PROGRAM_ID      - Raydium AMM program (optional, for on-chain tx)
 *   TARGET_PRICE            - Target price in USD (default: 0.02)
 *   XAILENS_AMOUNT          - Amount of XAILENS to seed (default: 5,000,000)
 *
 * Usage:
 *   npx tsx scripts/seed-liquidity.ts
 *   npx tsx scripts/seed-liquidity.ts --calculate-only
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
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

const XAILENS_DECIMALS = 6;
const USDC_DECIMALS = 6;

// USDC mint addresses
const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Commonly used devnet USDC
);

// Raydium program IDs (mainnet)
const RAYDIUM_AMM_V4_MAINNET = new PublicKey(
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
);
const RAYDIUM_CLMM_MAINNET = new PublicKey(
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
);

// Default seeding parameters
const DEFAULT_TARGET_PRICE = 0.02; // opening pool price = public sale price, decided 2026-10-29 (docs/TOKENOMICS.md section 4)
const DEFAULT_XAILENS_AMOUNT = 25_000_000; // 25M XAILENS into the CPMM pool at TGE

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

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatTokens(amount: number, symbol: string): string {
  return `${amount.toLocaleString("en-US")} ${symbol}`;
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
// Calculations
// ---------------------------------------------------------------------------

interface LiquidityCalc {
  xailensAmount: number;
  usdcAmount: number;
  pricePerXailens: number;
  totalValueUsd: number;
  xailensRaw: bigint;
  usdcRaw: bigint;
  impliedFdv: number;
}

function calculateLiquidity(
  xailensAmount: number,
  targetPrice: number,
  totalSupply: number = 500_000_000
): LiquidityCalc {
  const usdcAmount = xailensAmount * targetPrice;
  const totalValueUsd = usdcAmount * 2; // AMM pool value = 2x one side
  const impliedFdv = totalSupply * targetPrice;

  return {
    xailensAmount,
    usdcAmount,
    pricePerXailens: targetPrice,
    totalValueUsd,
    xailensRaw: BigInt(xailensAmount) * BigInt(10 ** XAILENS_DECIMALS),
    usdcRaw: BigInt(Math.round(usdcAmount * 10 ** USDC_DECIMALS)),
    impliedFdv,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const calculateOnly = process.argv.includes("--calculate-only");

  // ---- Parse parameters --------------------------------------------------
  const targetPrice = process.env.TARGET_PRICE
    ? parseFloat(process.env.TARGET_PRICE)
    : DEFAULT_TARGET_PRICE;

  const xailensAmount = process.env.XAILENS_AMOUNT
    ? parseInt(process.env.XAILENS_AMOUNT, 10)
    : DEFAULT_XAILENS_AMOUNT;

  // ---- Connection --------------------------------------------------------
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = rpcUrl.includes("devnet")
    ? "devnet"
    : rpcUrl.includes("mainnet")
    ? "mainnet-beta"
    : rpcUrl;

  const isMainnet = cluster === "mainnet-beta";
  const usdcMint = isMainnet ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;

  console.log("=".repeat(64));
  console.log("XAILENS / USDC Liquidity Pool Seeding Helper");
  console.log("=".repeat(64));
  console.log(`RPC             : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Cluster         : ${cluster}`);
  console.log(`USDC Mint       : ${usdcMint.toBase58()}`);
  console.log(`Target Price    : ${formatUsd(targetPrice)} per XAILENS`);
  console.log(`XAILENS Amount  : ${formatTokens(xailensAmount, "XAILENS")}`);
  console.log();

  // ---- Calculate liquidity amounts ---------------------------------------
  const calc = calculateLiquidity(xailensAmount, targetPrice);

  console.log("-".repeat(64));
  console.log("Liquidity Calculation");
  console.log("-".repeat(64));
  console.log(`XAILENS to deposit  : ${formatTokens(calc.xailensAmount, "XAILENS")}`);
  console.log(`USDC to deposit     : ${formatUsd(calc.usdcAmount)}`);
  console.log(`Price per XAILENS   : ${formatUsd(calc.pricePerXailens)}`);
  console.log(`Total pool value    : ${formatUsd(calc.totalValueUsd)}`);
  console.log(`Implied FDV         : ${formatUsd(calc.impliedFdv)}`);
  console.log(`Implied Market Cap  : ${formatUsd(calc.impliedFdv)} (all tokens minted)`);
  console.log();
  console.log("Raw amounts for on-chain instructions:");
  console.log(`  XAILENS raw : ${calc.xailensRaw.toString()} (${XAILENS_DECIMALS} decimals)`);
  console.log(`  USDC raw    : ${calc.usdcRaw.toString()} (${USDC_DECIMALS} decimals)`);
  console.log();

  if (calculateOnly) {
    printInstructions(calc, usdcMint, cluster);
    return;
  }

  // ---- Check wallet balances ---------------------------------------------
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json";
  const deployer = loadKeypair(keypairPath);

  console.log("-".repeat(64));
  console.log("Wallet Balance Check");
  console.log("-".repeat(64));
  console.log(`Wallet          : ${deployer.publicKey.toBase58()}`);

  // SOL balance
  const solBalance = await connection.getBalance(deployer.publicKey);
  const solRequired = 4.0; // ~4 SOL for pool creation rent + fees
  const solOk = solBalance / LAMPORTS_PER_SOL >= solRequired;
  console.log(
    `SOL             : ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL ` +
      `(need ~${solRequired} SOL) ${solOk ? "[OK]" : "[INSUFFICIENT]"}`
  );

  // XAILENS balance
  const mintStr = process.env.XAILENS_MINT;
  let xailensOk = false;
  if (mintStr) {
    const mint = new PublicKey(mintStr);
    try {
      const mintOwner = (await connection.getAccountInfo(mint))?.owner;
      const xailensProgram = mintOwner && mintOwner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const ataAddress = getAssociatedTokenAddressSync(mint, deployer.publicKey, false, xailensProgram);
      const account = await getAccount(connection, ataAddress, 'confirmed', xailensProgram);
      const xailensBal =
        Number(account.amount) / 10 ** XAILENS_DECIMALS;
      xailensOk = xailensBal >= calc.xailensAmount;
      console.log(
        `XAILENS         : ${formatTokens(xailensBal, "")} ` +
          `(need ${formatTokens(calc.xailensAmount, "")}) ` +
          `${xailensOk ? "[OK]" : "[INSUFFICIENT]"}`
      );
    } catch {
      console.log(`XAILENS         : Could not fetch ATA (mint: ${mintStr})`);
    }
  } else {
    console.log(
      "XAILENS         : Set XAILENS_MINT to check balance"
    );
  }

  // USDC balance
  let usdcOk = false;
  try {
    // USDC uses the standard Token program, not Token-2022
    const usdcAtaAddress = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey, false, TOKEN_PROGRAM_ID);
    const usdcAccount = await getAccount(connection, usdcAtaAddress, 'confirmed', TOKEN_PROGRAM_ID);
    const usdcBal = Number(usdcAccount.amount) / 10 ** USDC_DECIMALS;
    usdcOk = usdcBal >= calc.usdcAmount;
    console.log(
      `USDC            : ${formatUsd(usdcBal)} ` +
        `(need ${formatUsd(calc.usdcAmount)}) ` +
        `${usdcOk ? "[OK]" : "[INSUFFICIENT]"}`
    );
  } catch {
    console.log(
      "USDC            : No USDC ATA found. You need USDC to seed liquidity."
    );
  }

  console.log();

  // ---- Check for Raydium program ID --------------------------------------
  const raydiumProgramStr = process.env.RAYDIUM_PROGRAM_ID;
  if (raydiumProgramStr) {
    console.log("-".repeat(64));
    console.log("Raydium On-Chain Pool Creation");
    console.log("-".repeat(64));
    console.log(`Raydium Program : ${raydiumProgramStr}`);
    console.log();
    console.log(
      "NOTE: Automated Raydium pool creation requires the Raydium SDK " +
        "(@raydium-io/raydium-sdk-v2) which provides the instruction builders. " +
        "This script provides the calculated parameters; use the Raydium SDK " +
        "or UI to create the pool."
    );
    console.log();
    console.log("Required Raydium SDK call parameters:");
    console.log(`  baseMint       : ${mintStr ?? "<XAILENS_MINT>"} (XAILENS - Token-2022)`);
    console.log(`  quoteMint      : ${usdcMint.toBase58()} (USDC)`);
    console.log(`  baseAmount     : ${calc.xailensRaw.toString()}`);
    console.log(`  quoteAmount    : ${calc.usdcRaw.toString()}`);
    console.log(`  initialPrice   : ${targetPrice}`);
    console.log();

    // Note about Token-2022 compatibility with Raydium
    console.log("IMPORTANT: Token-2022 Compatibility");
    console.log(
      "  Use a Raydium CPMM pool. CPMM and CLMM accept Token-2022 mints; " +
        "AMM v4 does not. CPMM issues fungible LP tokens, which is what the " +
        "LP lock in docs/TOKENOMICS.md assumes."
    );
    console.log();
  }

  // ---- Print manual instructions -----------------------------------------
  printInstructions(calc, usdcMint, cluster);
}

// ---------------------------------------------------------------------------
// Print step-by-step instructions
// ---------------------------------------------------------------------------

function printInstructions(
  calc: LiquidityCalc,
  usdcMint: PublicKey,
  cluster: string
): void {
  console.log("=".repeat(64));
  console.log("Step-by-Step: Create XAILENS/USDC Pool on Raydium");
  console.log("=".repeat(64));
  console.log();
  console.log("Option A: Raydium UI (Recommended for first-time setup)");
  console.log("-".repeat(64));
  console.log("1. Go to https://raydium.io/liquidity/create-pool/");
  console.log("2. Connect your wallet (the deployer/LP wallet)");
  console.log("3. Select pool type: Standard (CPMM). Not AMM v4, not CLMM (see header).");
  console.log("4. Token A (Base): Paste the XAILENS mint address");
  console.log("5. Token B (Quote): Select USDC");
  console.log(`6. Enter amounts:`);
  console.log(`   - XAILENS: ${calc.xailensAmount.toLocaleString()}`);
  console.log(`   - USDC:    ${calc.usdcAmount.toLocaleString()}`);
  console.log(
    `7. Verify the implied price is ~${formatUsd(calc.pricePerXailens)} per XAILENS`
  );
  console.log("8. Select fee tier (0.25% is common for new tokens)");
  console.log("9. Review and confirm the transaction");
  console.log();
  console.log("Option B: Raydium SDK (Programmatic)");
  console.log("-".repeat(64));
  console.log("1. Install: npm install @raydium-io/raydium-sdk-v2");
  console.log("2. Use Raydium.create() to initialize the SDK");
  console.log("3. For CLMM pools:");
  console.log("   ```");
  console.log("   const { execute } = await raydium.clmm.createPool({");
  console.log("     programId: CLMM_PROGRAM_ID,");
  console.log("     mint1: { address: XAILENS_MINT, programId: <XAILENS token program: legacy SPL at launch> },");
  console.log("     mint2: { address: USDC_MINT, programId: TOKEN_PROGRAM_ID },");
  console.log(`     initialPrice: new Decimal(${calc.pricePerXailens}),`);
  console.log("     startTime: new BN(0),");
  console.log("   });");
  console.log("   ```");
  console.log("4. After pool creation, open a position and add liquidity:");
  console.log("   ```");
  console.log("   await raydium.clmm.openPositionFromBase({");
  console.log("     poolInfo,");
  console.log(`     base: 'MintA',`);
  console.log(`     baseAmount: new BN('${calc.xailensRaw.toString()}'),`);
  console.log("     priceLower: new Decimal(0.05),  // lower bound");
  console.log("     priceUpper: new Decimal(0.50),  // upper bound");
  console.log("   });");
  console.log("   ```");
  console.log();
  console.log("Reference addresses:");
  console.log("-".repeat(64));
  console.log(`  USDC (mainnet)       : ${USDC_MINT_MAINNET.toBase58()}`);
  console.log(`  USDC (devnet)        : ${USDC_MINT_DEVNET.toBase58()}`);
  console.log(`  Raydium AMM V4       : ${RAYDIUM_AMM_V4_MAINNET.toBase58()}`);
  console.log(`  Raydium CLMM         : ${RAYDIUM_CLMM_MAINNET.toBase58()}`);
  console.log(`  Token-2022 Program   : ${TOKEN_2022_PROGRAM_ID.toBase58()}`);
  console.log();
  console.log("Post-pool-creation checklist:");
  console.log("-".repeat(64));
  console.log("  [ ] Verify pool appears on Raydium UI");
  console.log("  [ ] Verify price is correct on pool page");
  console.log("  [ ] Test a small swap in each direction");
  console.log("  [ ] Record pool ID / LP mint for monitoring");
  console.log("  [ ] Lock the CPMM LP tokens for the period published in docs/TOKENOMICS.md");
  console.log("  [ ] Publish pool id, LP mint and lock proof in README.md");
  console.log(
    "  [ ] Announce pool on social channels with the swap link"
  );
  console.log();

  function formatUsd(n: number): string {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
