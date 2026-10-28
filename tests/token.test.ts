/**
 * XAILENS token tests (localnet).
 *
 * Creates a fresh Token-2022 mint with on-chain metadata the same way
 * scripts/setup-metadata.ts does, mints the fixed supply, then verifies the
 * authority model a launchpad expects: no freeze authority, mint authority
 * revoked, metadata update authority revoked, supply fixed.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  LENGTH_SIZE,
  TYPE_SIZE,
  AuthorityType,
  createAssociatedTokenAccountInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getMintLen,
  getAccount,
  getTokenMetadata,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateAuthorityInstruction,
  pack,
} from "@solana/spl-token-metadata";
import type { TokenMetadata } from "@solana/spl-token-metadata";
import { expect } from "chai";

const DECIMALS = 6;
const TOTAL_SUPPLY_RAW = BigInt(500_000_000) * BigInt(10 ** DECIMALS);

async function expectTxFailure(p: Promise<unknown>, needle?: string): Promise<void> {
  let failed = false;
  try {
    await p;
  } catch (err: any) {
    failed = true;
    if (needle) {
      const text = `${err?.message ?? ""} ${JSON.stringify(err?.logs ?? "")}`;
      expect(text, `expected error containing "${needle}"`).to.include(needle);
    }
  }
  expect(failed, "transaction should have failed").to.be.true;
}

describe("XAILENS token (Token-2022 + metadata)", () => {
  // Use "confirmed" everywhere so reads after sendAndConfirm see the state.
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new Connection(env.connection.rpcEndpoint, "confirmed"),
    env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const connection = provider.connection;

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const walletA = Keypair.generate();
  const walletB = Keypair.generate();

  const ata = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  before(async () => {
    const metadata: TokenMetadata = {
      mint,
      name: "XAILENS",
      symbol: "XAILENS",
      uri: "https://example.invalid/token-metadata.json",
      additionalMetadata: [],
    };
    const mintLen = getMintLen([ExtensionType.MetadataPointer]);
    const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint,
        metadata: mint,
        name: metadata.name,
        symbol: metadata.symbol,
        uri: metadata.uri,
        mintAuthority: payer.publicKey,
        updateAuthority: payer.publicKey,
      }),
    );
    await provider.sendAndConfirm(tx, [payer, mintKeypair]);

    const tx2 = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata(payer.publicKey), payer.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createMintToInstruction(mint, ata(payer.publicKey), payer.publicKey, TOTAL_SUPPLY_RAW, [], TOKEN_2022_PROGRAM_ID),
    );
    await provider.sendAndConfirm(tx2, [payer]);

    for (const w of [walletA, walletB]) {
      const sig = await connection.requestAirdrop(w.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }
  });

  it("is a Token-2022 mint with 6 decimals, no freeze authority, on-chain metadata", async () => {
    const info = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(info.decimals).to.equal(DECIMALS);
    expect(info.isInitialized).to.be.true;
    expect(info.freezeAuthority).to.be.null;
    const md = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(md?.symbol).to.equal("XAILENS");
  });

  it("has exactly 500,000,000 supply", async () => {
    const info = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(info.supply).to.equal(TOTAL_SUPPLY_RAW);
  });

  it("transfers with transfer_checked", async () => {
    const amount = BigInt(1_000) * BigInt(10 ** DECIMALS);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata(walletA.publicKey), walletA.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(ata(payer.publicKey), mint, ata(walletA.publicKey), payer.publicKey, amount, DECIMALS, [], TOKEN_2022_PROGRAM_ID),
    );
    await provider.sendAndConfirm(tx, [payer]);
    const acc = await getAccount(connection, ata(walletA.publicKey), "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(acc.amount).to.equal(amount);
  });

  it("rejects a transfer with the wrong decimals", async () => {
    const ix = createTransferCheckedInstruction(ata(payer.publicKey), mint, ata(walletA.publicKey), payer.publicKey, BigInt(1), 9, [], TOKEN_2022_PROGRAM_ID);
    await expectTxFailure(provider.sendAndConfirm(new Transaction().add(ix), [payer]));
  });

  it("revokes mint authority and can no longer mint", async () => {
    const revoke = createSetAuthorityInstruction(mint, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID);
    await provider.sendAndConfirm(new Transaction().add(revoke), [payer]);

    const info = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(info.mintAuthority).to.be.null;

    const mintMore = createMintToInstruction(mint, ata(payer.publicKey), payer.publicKey, BigInt(1), [], TOKEN_2022_PROGRAM_ID);
    await expectTxFailure(provider.sendAndConfirm(new Transaction().add(mintMore), [payer]));

    const after = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(after.supply).to.equal(TOTAL_SUPPLY_RAW);
  });

  it("revokes metadata update authority and can no longer change the URI", async () => {
    const revoke = createUpdateAuthorityInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      oldAuthority: payer.publicKey,
      newAuthority: null,
    });
    await provider.sendAndConfirm(new Transaction().add(revoke), [payer]);

    const md = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(md?.updateAuthority === undefined || md?.updateAuthority === null || md?.updateAuthority.equals(PublicKey.default)).to.be.true;

    const { createUpdateFieldInstruction, Field } = await import("@solana/spl-token-metadata");
    const update = createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      field: Field.Uri,
      value: "https://example.invalid/changed.json",
    });
    await expectTxFailure(provider.sendAndConfirm(new Transaction().add(update), [payer]));
  });
});
