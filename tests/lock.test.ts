/**
 * xailens-lock program tests (localnet).
 *
 * Covers: upgrade-authority-only initialize, lock, threshold clocks, pause
 * semantics (blocks lock, never withdraw), unlock cooldown snapshot, withdraw,
 * close, admin bounds, unauthorized admin calls, two-step authority transfer.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
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
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getMintLen,
} from "@solana/spl-token";
import { expect } from "chai";
import type { XailensLock } from "../target/types/xailens_lock";

const DECIMALS = 6;
// Launch is on legacy SPL; set LOCK_TEST_TOKEN_PROGRAM=token2022 to run the same suite on Token-2022.
const TOKEN_PROGRAM = process.env.LOCK_TEST_TOKEN_PROGRAM === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
const raw = (ui: number) => new BN(ui).mul(new BN(10 ** DECIMALS));
const rawBig = (ui: number) => BigInt(ui) * BigInt(10 ** DECIMALS);
const DAY = 24 * 3600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function expectAnchorError(p: Promise<unknown>, code: string): Promise<void> {
  let failed = false;
  try {
    await p;
  } catch (err: any) {
    failed = true;
    const got = err?.error?.errorCode?.code ?? err?.message ?? String(err);
    expect(got, `expected ${code}`).to.include(code);
  }
  expect(failed, `expected failure with ${code}`).to.be.true;
}

describe(`xailens-lock (${TOKEN_PROGRAM.equals(TOKEN_PROGRAM_ID) ? "legacy SPL" : "Token-2022"})`, () => {
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

  const program = anchor.workspace.XailensLock as Program<XailensLock>;
  if (!program) throw new Error("xailens_lock not in workspace: run `anchor build` first");

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const user = Keypair.generate();
  const user2 = Keypair.generate();
  const stranger = Keypair.generate();
  const newAuthority = Keypair.generate();

  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool")], program.programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], program.programId);
  const lockPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("lock"), owner.toBuffer()], program.programId)[0];
  const ata = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ID);
  const [programData] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  );

  // Short cooldown so the withdraw path is exercised for real.
  const COOLDOWN = 2;
  const DISCOUNT = 1_000;
  const FOUNDER = 100_000;
  const VOTING = 100_000;

  const lockIx = (who: Keypair, amount: BN) =>
    program.methods
      .lock(amount)
      .accounts({
        user: who.publicKey,
        mint,
        userTokenAccount: ata(who.publicKey),
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([who])
      .rpc();

  const withdrawIx = (who: Keypair) =>
    program.methods
      .withdraw()
      .accounts({
        user: who.publicKey,
        mint,
        userTokenAccount: ata(who.publicKey),
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([who])
      .rpc();

  before(async () => {
    const mintLen = getMintLen([]);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_PROGRAM,
      }),
      createInitializeMintInstruction(mint, DECIMALS, payer.publicKey, null, TOKEN_PROGRAM),
    );
    await provider.sendAndConfirm(tx, [payer, mintKeypair]);

    for (const [who, amount] of [
      [user, 1_000_000],
      [user2, 5_000],
      [stranger, 5_000],
    ] as Array<[Keypair, number]>) {
      const sig = await connection.requestAirdrop(who.publicKey, 5 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      const fund = new Transaction().add(
        createAssociatedTokenAccountInstruction(payer.publicKey, ata(who.publicKey), who.publicKey, mint, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ID),
        createMintToInstruction(mint, ata(who.publicKey), payer.publicKey, rawBig(amount), [], TOKEN_PROGRAM),
      );
      await provider.sendAndConfirm(fund, [payer]);
    }
    const sig = await connection.requestAirdrop(newAuthority.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  });

  // ---------------------------------------------------------------- init

  it("rejects initialize from a wallet that is not the upgrade authority", async () => {
    await expectAnchorError(
      program.methods
        .initialize({
          cooldownPeriod: new BN(COOLDOWN),
          discountThreshold: raw(DISCOUNT),
          founderThreshold: raw(FOUNDER),
          votingThreshold: raw(VOTING),
        })
        .accountsPartial({ authority: stranger.publicKey, mint, program: program.programId, programData, tokenProgram: TOKEN_PROGRAM })
        .signers([stranger])
        .rpc(),
      "Unauthorized",
    );
  });

  it("rejects initialize with a cooldown above 30 days", async () => {
    await expectAnchorError(
      program.methods
        .initialize({
          cooldownPeriod: new BN(31 * DAY),
          discountThreshold: raw(DISCOUNT),
          founderThreshold: raw(FOUNDER),
          votingThreshold: raw(VOTING),
        })
        .accountsPartial({ authority: payer.publicKey, mint, program: program.programId, programData, tokenProgram: TOKEN_PROGRAM })
        .rpc(),
      "InvalidCooldown",
    );
  });

  it("initializes the pool as the upgrade authority", async () => {
    await program.methods
      .initialize({
        cooldownPeriod: new BN(COOLDOWN),
        discountThreshold: raw(DISCOUNT),
        founderThreshold: raw(FOUNDER),
        votingThreshold: raw(VOTING),
      })
      .accountsPartial({ authority: payer.publicKey, mint, program: program.programId, programData, tokenProgram: TOKEN_PROGRAM })
      .rpc();

    const pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.authority.equals(payer.publicKey)).to.be.true;
    expect(pool.pendingAuthority.equals(PublicKey.default)).to.be.true;
    expect(pool.mint.equals(mint)).to.be.true;
    expect(pool.vault.equals(vaultPda)).to.be.true;
    expect(pool.cooldownPeriod.toNumber()).to.equal(COOLDOWN);
    expect(pool.totalLocked.toNumber()).to.equal(0);
    expect(pool.paused).to.be.false;
  });

  it("cannot initialize twice", async () => {
    let failed = false;
    try {
      await program.methods
        .initialize({
          cooldownPeriod: new BN(COOLDOWN),
          discountThreshold: raw(DISCOUNT),
          founderThreshold: raw(FOUNDER),
          votingThreshold: raw(VOTING),
        })
        .accountsPartial({ authority: payer.publicKey, mint, program: program.programId, programData, tokenProgram: TOKEN_PROGRAM })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ---------------------------------------------------------------- lock

  it("rejects a lock below the 1 XAILENS minimum", async () => {
    await expectAnchorError(lockIx(user, new BN(999_999)), "BelowMinimumLock");
  });

  it("locks below every threshold: clocks stay at 0", async () => {
    await lockIx(user2, raw(500));
    const acc = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(acc.amount.toString()).to.equal(raw(500).toString());
    expect(acc.lockedSince.toNumber()).to.be.greaterThan(0);
    expect(acc.discountSince.toNumber()).to.equal(0);
    expect(acc.founderSince.toNumber()).to.equal(0);
    expect(acc.votingSince.toNumber()).to.equal(0);
  });

  it("starts the discount clock when the discount threshold is crossed by a top-up", async () => {
    await lockIx(user2, raw(500)); // total 1,000 = discount threshold
    const acc = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(acc.amount.toString()).to.equal(raw(1_000).toString());
    expect(acc.discountSince.toNumber()).to.be.greaterThan(0);
    expect(acc.founderSince.toNumber()).to.equal(0);
    expect(acc.lockedSince.toNumber()).to.be.at.most(acc.discountSince.toNumber());
  });

  it("does not reset an already running clock on a further top-up", async () => {
    const before = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    await sleep(1500);
    await lockIx(user2, raw(100));
    const after = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(after.discountSince.toNumber()).to.equal(before.discountSince.toNumber());
    expect(after.lastDepositAt.toNumber()).to.be.at.least(before.lastDepositAt.toNumber());
  });

  it("starts all three clocks for a Founder-sized lock and moves tokens into the vault", async () => {
    const balBefore = (await getAccount(connection, ata(user.publicKey), "confirmed", TOKEN_PROGRAM)).amount;
    await lockIx(user, raw(FOUNDER));
    const acc = await program.account.lockAccount.fetch(lockPda(user.publicKey));
    expect(acc.discountSince.toNumber()).to.be.greaterThan(0);
    expect(acc.founderSince.toNumber()).to.be.greaterThan(0);
    expect(acc.votingSince.toNumber()).to.be.greaterThan(0);

    const balAfter = (await getAccount(connection, ata(user.publicKey), "confirmed", TOKEN_PROGRAM)).amount;
    expect(balBefore - balAfter).to.equal(rawBig(FOUNDER));
    const vault = await getAccount(connection, vaultPda, "confirmed", TOKEN_PROGRAM);
    expect(vault.amount).to.equal(rawBig(FOUNDER) + rawBig(1_100));
    const pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.totalLocked.toString()).to.equal(raw(FOUNDER + 1_100).toString());
  });

  // ---------------------------------------------------------------- admin

  it("rejects update_pool from a non-authority", async () => {
    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: null, discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: true })
        .accounts({ authority: stranger.publicKey })
        .signers([stranger])
        .rpc(),
      "Unauthorized",
    );
  });

  it("rejects a cooldown above 30 days in update_pool", async () => {
    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: new BN(MAX_COOLDOWN_PLUS_ONE()), discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: null })
        .accounts({ authority: payer.publicKey })
        .rpc(),
      "InvalidCooldown",
    );
  });

  it("rejects a discount threshold above the Founder threshold", async () => {
    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: null, discountThreshold: raw(FOUNDER + 1), founderThreshold: null, votingThreshold: null, paused: null })
        .accounts({ authority: payer.publicKey })
        .rpc(),
      "InvalidThresholds",
    );
  });

  // ---------------------------------------------------------------- pause

  it("pause blocks new locks", async () => {
    await program.methods
      .updatePool({ cooldownPeriod: null, discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: true })
      .accounts({ authority: payer.publicKey })
      .rpc();
    await expectAnchorError(lockIx(stranger, raw(1_000)), "PoolPaused");
  });

  it("pause does NOT block request_unlock or withdraw", async () => {
    // user2 requests unlock while paused
    await program.methods.requestUnlock().accounts({ user: user2.publicKey }).signers([user2]).rpc();
    const acc = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(acc.unlockRequestedAt.toNumber()).to.be.greaterThan(0);
    expect(acc.unlockCooldown.toNumber()).to.equal(COOLDOWN);
    // clocks cleared on unlock request
    expect(acc.discountSince.toNumber()).to.equal(0);

    // admin tries to extend the cooldown after the request: must not affect user2
    await program.methods
      .updatePool({ cooldownPeriod: new BN(20 * DAY), discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: null })
      .accounts({ authority: payer.publicKey })
      .rpc();

    await sleep((COOLDOWN + 1) * 1000);
    const balBefore = (await getAccount(connection, ata(user2.publicKey), "confirmed", TOKEN_PROGRAM)).amount;
    await withdrawIx(user2); // still paused
    const balAfter = (await getAccount(connection, ata(user2.publicKey), "confirmed", TOKEN_PROGRAM)).amount;
    expect(balAfter - balBefore).to.equal(rawBig(1_100));

    const after = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(after.amount.toNumber()).to.equal(0);
    expect(after.unlockRequestedAt.toNumber()).to.equal(0);

    // restore
    await program.methods
      .updatePool({ cooldownPeriod: new BN(COOLDOWN), discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: false })
      .accounts({ authority: payer.publicKey })
      .rpc();
  });

  it("closes an empty lock account and returns rent", async () => {
    const lamportsBefore = await connection.getBalance(user2.publicKey);
    await program.methods.closeLockAccount().accounts({ user: user2.publicKey }).signers([user2]).rpc();
    const info = await connection.getAccountInfo(lockPda(user2.publicKey));
    expect(info).to.be.null;
    expect(await connection.getBalance(user2.publicKey)).to.be.greaterThan(lamportsBefore);
  });

  it("refuses to close a lock account that still holds tokens", async () => {
    await expectAnchorError(
      program.methods.closeLockAccount().accounts({ user: user.publicKey }).signers([user]).rpc(),
      "StillLocked",
    );
  });

  // ---------------------------------------------------------------- unlock flow

  it("cannot withdraw without an unlock request", async () => {
    await expectAnchorError(withdrawIx(user), "NoUnlockRequested");
  });

  it("cannot lock more while an unlock is pending, and cannot request twice", async () => {
    await program.methods.requestUnlock().accounts({ user: user.publicKey }).signers([user]).rpc();
    await expectAnchorError(lockIx(user, raw(1_000)), "UnlockAlreadyRequested");
    await expectAnchorError(
      program.methods.requestUnlock().accounts({ user: user.publicKey }).signers([user]).rpc(),
      "UnlockAlreadyRequested",
    );
  });

  it("cannot withdraw before the cooldown elapses", async () => {
    await expectAnchorError(withdrawIx(user), "CooldownNotElapsed");
  });

  it("withdraws the full amount after the cooldown", async () => {
    await sleep((COOLDOWN + 1) * 1000);
    await withdrawIx(user);
    const bal = (await getAccount(connection, ata(user.publicKey), "confirmed", TOKEN_PROGRAM)).amount;
    expect(bal).to.equal(rawBig(1_000_000));
    const pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.totalLocked.toNumber()).to.equal(0);
  });

  it("a stranger cannot act on another wallet's lock account", async () => {
    await lockIx(user, raw(1_000));
    let failed = false;
    try {
      await program.methods
        .requestUnlock()
        .accountsPartial({ user: stranger.publicKey, lockAccount: lockPda(user.publicKey) })
        .signers([stranger])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ---------------------------------------------------------------- authority transfer

  it("transfers authority in two steps and the old key loses access", async () => {
    await expectAnchorError(
      program.methods.acceptAuthority().accounts({ newAuthority: newAuthority.publicKey }).signers([newAuthority]).rpc(),
      "Unauthorized",
    );
    await program.methods.proposeAuthority(newAuthority.publicKey).accounts({ authority: payer.publicKey }).rpc();
    let pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.pendingAuthority.equals(newAuthority.publicKey)).to.be.true;
    expect(pool.authority.equals(payer.publicKey)).to.be.true;

    await expectAnchorError(
      program.methods.acceptAuthority().accounts({ newAuthority: stranger.publicKey }).signers([stranger]).rpc(),
      "Unauthorized",
    );
    await program.methods.acceptAuthority().accounts({ newAuthority: newAuthority.publicKey }).signers([newAuthority]).rpc();
    pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.authority.equals(newAuthority.publicKey)).to.be.true;
    expect(pool.pendingAuthority.equals(PublicKey.default)).to.be.true;

    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: null, discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: true })
        .accounts({ authority: payer.publicKey })
        .rpc(),
      "Unauthorized",
    );
  });
});

function MAX_COOLDOWN_PLUS_ONE(): number {
  return 30 * DAY + 1;
}
