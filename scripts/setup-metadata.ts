/**
 * XAILENS Token Metadata Setup Script
 *
 * Sets on-chain metadata for the XAILENS token using the Token-2022
 * metadata extension.
 *
 * How Token-2022 metadata works:
 * ------------------------------
 * Token-2022 (SPL Token 2022) supports metadata natively via extensions.
 * Instead of relying on Metaplex, metadata (name, symbol, URI, and
 * additional key-value fields) is stored directly in the mint account.
 *
 * There are two parts to the on-chain metadata approach:
 *
 *   1. MetadataPointer extension - tells clients where the metadata lives.
 *      When the pointer points to the mint itself, the metadata is stored
 *      in the same account (most common pattern).
 *
 *   2. TokenMetadata - the actual name/symbol/uri/additional-fields data
 *      stored in the mint account's extension space.
 *
 * IMPORTANT: Both the MetadataPointer and TokenMetadata extensions must be
 * initialized BEFORE the mint is initialized (i.e., during mint creation
 * in a single atomic transaction). You cannot add extensions to an
 * already-initialized mint.
 *
 * This script therefore has TWO modes:
 *   A) "create" - Creates a NEW mint with metadata extensions already
 *      configured. Use this instead of deploy-token.ts if you want
 *      metadata from the start.
 *   B) "update-field" - Updates a single metadata field on an existing
 *      mint that already has the metadata extension. Useful for changing
 *      the URI post-launch.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - Path to deployer keypair JSON
 *   XAILENS_MINT            - Existing mint address (for update-field mode)
 *
 * Usage:
 *   npx tsx scripts/setup-metadata.ts create
 *   npx tsx scripts/setup-metadata.ts update-field uri https://xailens.com/token-metadata-v2.json
 */

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  createInitializeMetadataPointerInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  TokenMetadata,
} from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECIMALS = 6;
const TOTAL_SUPPLY = 500_000_000;
const RAW_SUPPLY = BigInt(TOTAL_SUPPLY) * BigInt(10 ** DECIMALS);

const TOKEN_NAME = "XAILENS";
const TOKEN_SYMBOL = "XAILENS";
const TOKEN_URI = "https://xailens.com/token-metadata.json";

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
  const params = cluster.includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/address/${address}${params}`;
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
// Mode A: Create a new mint WITH metadata extension
// ---------------------------------------------------------------------------

async function createMintWithMetadata(
  connection: Connection,
  payer: Keypair,
  cluster: string
): Promise<void> {
  console.log("=".repeat(60));
  console.log("Creating new Token-2022 mint with metadata extension");
  console.log("=".repeat(60));

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  console.log(`Mint (new)     : ${mint.toBase58()}`);
  console.log(`Name           : ${TOKEN_NAME}`);
  console.log(`Symbol         : ${TOKEN_SYMBOL}`);
  console.log(`URI            : ${TOKEN_URI}`);
  console.log(`Decimals       : ${DECIMALS}`);
  console.log();

  // -- Build the metadata that will be stored on-chain ---------------------
  const metadata: TokenMetadata = {
    mint: mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    // Additional custom fields can be added here as key-value pairs:
    additionalMetadata: [["website", "https://xailens.com"]],
  };

  // -- Calculate account size & rent ---------------------------------------
  // The mint account needs space for:
  //   - base mint data
  //   - MetadataPointer extension
  //   - TokenMetadata extension (variable size based on metadata content)
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const totalLen = mintLen + metadataLen;

  const lamports = await connection.getMinimumBalanceForRentExemption(totalLen);
  console.log(
    `Account size   : ${totalLen} bytes (${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL rent)`
  );

  // -- Build transaction ---------------------------------------------------
  // The order of instructions matters:
  //   1. Create the account (SystemProgram)
  //   2. Initialize MetadataPointer (points to the mint itself)
  //   3. Initialize the Mint
  //   4. Initialize the TokenMetadata with name/symbol/uri
  const tx = new Transaction().add(
    // 1. Create account with enough space
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),

    // 2. Initialize MetadataPointer - point to the mint itself
    //    This tells clients "metadata for this mint is stored in this
    //    same account".
    createInitializeMetadataPointerInstruction(
      mint, // mint account
      payer.publicKey, // authority that can update the pointer
      mint, // metadata address (self-referential)
      TOKEN_2022_PROGRAM_ID
    ),

    // 3. Initialize the mint (must come after extension inits, before
    //    metadata init)
    createInitializeMintInstruction(
      mint,
      DECIMALS,
      payer.publicKey, // mint authority
      null, // freeze authority
      TOKEN_2022_PROGRAM_ID
    ),

    // 4. Initialize token metadata stored in the mint account
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint,
      metadata: mint, // metadata is on the mint itself
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    })
  );

  // Optionally add custom fields
  for (const [key, value] of metadata.additionalMetadata) {
    tx.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: payer.publicKey,
        field: key,
        value: value,
      })
    );
  }

  console.log("Sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [
    payer,
    mintKeypair,
  ], { commitment: "confirmed" });
  console.log(`Tx Signature   : ${sig}`);
  console.log();

  // -- Mint full supply to deployer ATA ------------------------------------
  console.log("Creating deployer ATA and minting full supply...");
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const mintTxSig = await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer,
    RAW_SUPPLY,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`Mint Tx        : ${mintTxSig}`);

  // -- Summary -------------------------------------------------------------
  const mintInfo = await getMint(
    connection,
    mint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  console.log();
  console.log("=".repeat(60));
  console.log("Mint Created with Metadata");
  console.log("=".repeat(60));
  console.log(`Mint Address   : ${mint.toBase58()}`);
  console.log(`Deployer ATA   : ${ata.address.toBase58()}`);
  console.log(
    `Total Supply   : ${(
      Number(mintInfo.supply) / 10 ** DECIMALS
    ).toLocaleString()} XAILENS`
  );
  console.log(`Explorer       : ${explorerUrl(mint.toBase58(), cluster)}`);
  console.log();
  console.log("On-chain metadata set:");
  console.log(`  name   = ${TOKEN_NAME}`);
  console.log(`  symbol = ${TOKEN_SYMBOL}`);
  console.log(`  uri    = ${TOKEN_URI}`);
}

// ---------------------------------------------------------------------------
// Mode B: Update a metadata field on an existing mint
// ---------------------------------------------------------------------------

async function updateMetadataField(
  connection: Connection,
  payer: Keypair,
  mintAddress: PublicKey,
  field: string,
  value: string,
  cluster: string
): Promise<void> {
  console.log("=".repeat(60));
  console.log("Updating Token-2022 Metadata Field");
  console.log("=".repeat(60));
  console.log(`Mint           : ${mintAddress.toBase58()}`);
  console.log(`Field          : ${field}`);
  console.log(`New Value      : ${value}`);
  console.log();

  // Verify the mint exists and has metadata
  await getMint(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);

  // Build the update-field instruction.
  // For standard fields (name, symbol, uri), the Token-2022 program
  // recognises them by key name. For custom fields, it stores them in
  // the additionalMetadata array.
  const ix = createUpdateFieldInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    metadata: mintAddress, // metadata lives on the mint
    updateAuthority: payer.publicKey,
    field: field,
    value: value,
  });

  const tx = new Transaction().add(ix);

  console.log("Sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });

  console.log(`Tx Signature   : ${sig}`);
  console.log(`Explorer       : ${explorerUrl(mintAddress.toBase58(), cluster)}`);
  console.log();
  console.log(`Successfully updated "${field}" to "${value}".`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (!mode || !["create", "update-field"].includes(mode)) {
    console.log("Usage:");
    console.log("  npx tsx scripts/setup-metadata.ts create");
    console.log(
      "  npx tsx scripts/setup-metadata.ts update-field <field> <value>"
    );
    console.log();
    console.log("Modes:");
    console.log(
      "  create        - Create a NEW mint with metadata extension + full supply"
    );
    console.log(
      "  update-field  - Update a metadata field on an existing mint"
    );
    console.log();
    console.log("Examples:");
    console.log(
      '  npx tsx scripts/setup-metadata.ts update-field uri "https://xailens.com/v2.json"'
    );
    console.log(
      '  npx tsx scripts/setup-metadata.ts update-field website "https://app.xailens.com"'
    );
    process.exit(1);
  }

  // ---- Connection --------------------------------------------------------
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = rpcUrl.includes("devnet")
    ? "devnet"
    : rpcUrl.includes("mainnet")
    ? "mainnet-beta"
    : rpcUrl;

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

  console.log(`RPC            : ${sanitizeRpcUrl(rpcUrl)}`);
  console.log(`Cluster        : ${cluster}`);
  console.log();

  // ---- Keypair -----------------------------------------------------------
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json";
  const payer = loadKeypair(keypairPath);
  console.log(`Authority      : ${payer.publicKey.toBase58()}`);
  console.log();

  // ---- Dispatch ----------------------------------------------------------
  if (mode === "create") {
    await createMintWithMetadata(connection, payer, cluster);
  } else if (mode === "update-field") {
    const field = args[1];
    const value = args[2];
    if (!field || value === undefined) {
      console.error(
        "Error: update-field requires <field> and <value> arguments."
      );
      process.exit(1);
    }

    const mintStr = process.env.XAILENS_MINT;
    if (!mintStr) {
      console.error(
        "Error: Set XAILENS_MINT environment variable to the mint address."
      );
      process.exit(1);
    }
    const mintAddress = new PublicKey(mintStr);
    await updateMetadataField(connection, payer, mintAddress, field, value, cluster);
  }
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
