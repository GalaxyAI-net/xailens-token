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
  ExtensionType,
  createInitializeTransferFeeConfigInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeMetadataPointerInstruction,
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

  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool"), mint.toBuffer()], program.programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], program.programId);
  const lockPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("lock"), poolPda.toBuffer(), owner.toBuffer()], program.programId)[0];
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
        .accountsPartial({ authority: stranger.publicKey, pool: poolPda })
        .signers([stranger])
        .rpc(),
      "Unauthorized",
    );
  });

  it("rejects a cooldown above 30 days in update_pool", async () => {
    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: new BN(MAX_COOLDOWN_PLUS_ONE()), discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: null })
        .accountsPartial({ authority: payer.publicKey, pool: poolPda })
        .rpc(),
      "InvalidCooldown",
    );
  });

  it("rejects a discount threshold above the Founder threshold", async () => {
    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: null, discountThreshold: raw(FOUNDER + 1), founderThreshold: null, votingThreshold: null, paused: null })
        .accountsPartial({ authority: payer.publicKey, pool: poolPda })
        .rpc(),
      "InvalidThresholds",
    );
  });

  // ---------------------------------------------------------------- pause

  it("pause blocks new locks", async () => {
    await program.methods
      .updatePool({ cooldownPeriod: null, discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: true })
      .accountsPartial({ authority: payer.publicKey, pool: poolPda })
      .rpc();
    await expectAnchorError(lockIx(stranger, raw(1_000)), "PoolPaused");
  });

  it("pause does NOT block request_unlock or withdraw", async () => {
    // user2 requests unlock while paused
    await program.methods.requestUnlock().accountsPartial({ user: user2.publicKey, pool: poolPda }).signers([user2]).rpc();
    const acc = await program.account.lockAccount.fetch(lockPda(user2.publicKey));
    expect(acc.unlockRequestedAt.toNumber()).to.be.greaterThan(0);
    expect(acc.unlockCooldown.toNumber()).to.equal(COOLDOWN);
    // clocks cleared on unlock request
    expect(acc.discountSince.toNumber()).to.equal(0);

    // admin tries to extend the cooldown after the request: must not affect user2
    await program.methods
      .updatePool({ cooldownPeriod: new BN(20 * DAY), discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: null })
      .accountsPartial({ authority: payer.publicKey, pool: poolPda })
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
      .accountsPartial({ authority: payer.publicKey, pool: poolPda })
      .rpc();
  });

  it("closes an empty lock account and returns rent", async () => {
    const lamportsBefore = await connection.getBalance(user2.publicKey);
    await program.methods.closeLockAccount().accountsPartial({ user: user2.publicKey, pool: poolPda }).signers([user2]).rpc();
    const info = await connection.getAccountInfo(lockPda(user2.publicKey));
    expect(info).to.be.null;
    expect(await connection.getBalance(user2.publicKey)).to.be.greaterThan(lamportsBefore);
  });

  it("refuses to close a lock account that still holds tokens", async () => {
    await expectAnchorError(
      program.methods.closeLockAccount().accountsPartial({ user: user.publicKey, pool: poolPda }).signers([user]).rpc(),
      "StillLocked",
    );
  });

  // ---------------------------------------------------------------- unlock flow

  it("cannot withdraw without an unlock request", async () => {
    await expectAnchorError(withdrawIx(user), "NoUnlockRequested");
  });

  it("cannot lock more while an unlock is pending, and cannot request twice", async () => {
    await program.methods.requestUnlock().accountsPartial({ user: user.publicKey, pool: poolPda }).signers([user]).rpc();
    await expectAnchorError(lockIx(user, raw(1_000)), "UnlockAlreadyRequested");
    await expectAnchorError(
      program.methods.requestUnlock().accountsPartial({ user: user.publicKey, pool: poolPda }).signers([user]).rpc(),
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
        .accountsPartial({ user: stranger.publicKey, pool: poolPda, lockAccount: lockPda(user.publicKey) })
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
      program.methods.acceptAuthority().accountsPartial({ newAuthority: newAuthority.publicKey, pool: poolPda }).signers([newAuthority]).rpc(),
      "Unauthorized",
    );
    await program.methods.proposeAuthority(newAuthority.publicKey).accountsPartial({ authority: payer.publicKey, pool: poolPda }).rpc();
    let pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.pendingAuthority.equals(newAuthority.publicKey)).to.be.true;
    expect(pool.authority.equals(payer.publicKey)).to.be.true;

    await expectAnchorError(
      program.methods.acceptAuthority().accountsPartial({ newAuthority: stranger.publicKey, pool: poolPda }).signers([stranger]).rpc(),
      "Unauthorized",
    );
    await program.methods.acceptAuthority().accountsPartial({ newAuthority: newAuthority.publicKey, pool: poolPda }).signers([newAuthority]).rpc();
    pool = await program.account.lockPool.fetch(poolPda);
    expect(pool.authority.equals(newAuthority.publicKey)).to.be.true;
    expect(pool.pendingAuthority.equals(PublicKey.default)).to.be.true;

    await expectAnchorError(
      program.methods
        .updatePool({ cooldownPeriod: null, discountThreshold: null, founderThreshold: null, votingThreshold: null, paused: true })
        .accountsPartial({ authority: payer.publicKey, pool: poolPda })
        .rpc(),
      "Unauthorized",
    );
  });

  // ---------------------------------------------------------------- F1: one pool per mint (Token-2022 migration)

  describe("F1: a second pool for a second mint (migration)", () => {
    // The migration mint lives under the *other* token program.
    const TOKEN_PROGRAM_2 = TOKEN_PROGRAM.equals(TOKEN_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const mint2Keypair = Keypair.generate();
    const mint2 = mint2Keypair.publicKey;
    const [pool2] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool"), mint2.toBuffer()], program.programId);
    const [vault2] = PublicKey.findProgramAddressSync([Buffer.from("vault"), pool2.toBuffer()], program.programId);
    const lockPda2 = (owner: PublicKey) =>
      PublicKey.findProgramAddressSync([Buffer.from("lock"), pool2.toBuffer(), owner.toBuffer()], program.programId)[0];
    const ata2 = (owner: PublicKey) =>
      getAssociatedTokenAddressSync(mint2, owner, false, TOKEN_PROGRAM_2, ASSOCIATED_TOKEN_PROGRAM_ID);

    before(async () => {
      const mintLen = getMintLen([]);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint2, space: mintLen, lamports, programId: TOKEN_PROGRAM_2 }),
          createInitializeMintInstruction(mint2, DECIMALS, payer.publicKey, null, TOKEN_PROGRAM_2),
          createAssociatedTokenAccountInstruction(payer.publicKey, ata2(user.publicKey), user.publicKey, mint2, TOKEN_PROGRAM_2, ASSOCIATED_TOKEN_PROGRAM_ID),
          createMintToInstruction(mint2, ata2(user.publicKey), payer.publicKey, rawBig(50_000), [], TOKEN_PROGRAM_2),
        ),
        [payer, mint2Keypair],
      );
    });

    it("initializes a second pool for the second mint (upgrade authority only)", async () => {
      await program.methods
        .initialize({ cooldownPeriod: new BN(COOLDOWN), discountThreshold: raw(DISCOUNT), founderThreshold: raw(FOUNDER), votingThreshold: raw(VOTING) })
        .accountsPartial({ authority: payer.publicKey, mint: mint2, pool: pool2, vault: vault2, program: program.programId, programData, tokenProgram: TOKEN_PROGRAM_2 })
        .rpc();
      const p2 = await program.account.lockPool.fetch(pool2);
      expect(p2.mint.equals(mint2)).to.be.true;
      expect(p2.vault.equals(vault2)).to.be.true;
      // the first pool is untouched
      const p1 = await program.account.lockPool.fetch(poolPda);
      expect(p1.mint.equals(mint)).to.be.true;
    });

    it("keeps lock positions separate per pool", async () => {
      const before1 = await program.account.lockAccount.fetch(lockPda(user.publicKey));
      await program.methods
        .lock(raw(20_000))
        .accountsPartial({ user: user.publicKey, pool: pool2, mint: mint2, lockAccount: lockPda2(user.publicKey), userTokenAccount: ata2(user.publicKey), vault: vault2, tokenProgram: TOKEN_PROGRAM_2 })
        .signers([user])
        .rpc();
      const acc2 = await program.account.lockAccount.fetch(lockPda2(user.publicKey));
      expect(acc2.amount.toString()).to.equal(raw(20_000).toString());
      expect(acc2.pool.equals(pool2)).to.be.true;
      const after1 = await program.account.lockAccount.fetch(lockPda(user.publicKey));
      expect(after1.amount.toString()).to.equal(before1.amount.toString());
      expect((await program.account.lockPool.fetch(pool2)).totalLocked.toString()).to.equal(raw(20_000).toString());
      expect((await getAccount(connection, vault2, "confirmed", TOKEN_PROGRAM_2)).amount).to.equal(rawBig(20_000));
    });

    it("rejects a lock account from one pool used against the other pool", async () => {
      let failed = false;
      try {
        await program.methods
          .requestUnlock()
          .accountsPartial({ user: user.publicKey, pool: poolPda, lockAccount: lockPda2(user.publicKey) })
          .signers([user])
          .rpc();
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;
      const acc2 = await program.account.lockAccount.fetch(lockPda2(user.publicKey));
      expect(acc2.unlockRequestedAt.toNumber()).to.equal(0);
    });
  });

  // ---------------------------------------------------------------- F2/F3: initialize only accepts safe mints

  describe("initialize rejects unsafe mints", () => {
    const initFor = (m: PublicKey, tokenProgram: PublicKey) =>
      program.methods
        .initialize({ cooldownPeriod: new BN(COOLDOWN), discountThreshold: raw(DISCOUNT), founderThreshold: raw(FOUNDER), votingThreshold: raw(VOTING) })
        .accountsPartial({ authority: payer.publicKey, mint: m, program: program.programId, programData, tokenProgram })
        .rpc();

    /** Create a mint under `tokenProgram`, optionally with extension init instructions placed before InitializeMint. */
    async function makeMint(opts: {
      tokenProgram: PublicKey;
      decimals?: number;
      freezeAuthority?: PublicKey | null;
      extensions?: ExtensionType[];
      extensionIxs?: (m: PublicKey) => anchor.web3.TransactionInstruction[];
    }): Promise<PublicKey> {
      const kp = Keypair.generate();
      const len = getMintLen(opts.extensions ?? []);
      const lamports = await connection.getMinimumBalanceForRentExemption(len);
      const tx = new Transaction().add(
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: len, lamports, programId: opts.tokenProgram }),
        ...(opts.extensionIxs ? opts.extensionIxs(kp.publicKey) : []),
        createInitializeMintInstruction(kp.publicKey, opts.decimals ?? DECIMALS, payer.publicKey, opts.freezeAuthority ?? null, opts.tokenProgram),
      );
      await provider.sendAndConfirm(tx, [payer, kp]);
      return kp.publicKey;
    }

    it("F2: rejects a mint whose decimals are not 6", async () => {
      const m = await makeMint({ tokenProgram: TOKEN_PROGRAM, decimals: 9 });
      await expectAnchorError(initFor(m, TOKEN_PROGRAM), "InvalidMint");
    });

    it("F2: rejects a mint with a freeze authority (it could freeze the vault and block withdrawals)", async () => {
      const m = await makeMint({ tokenProgram: TOKEN_PROGRAM, freezeAuthority: payer.publicKey });
      await expectAnchorError(initFor(m, TOKEN_PROGRAM), "InvalidMint");
    });

    it("F3: rejects a Token-2022 mint with TransferFeeConfig (vault would receive less than credited)", async () => {
      const m = await makeMint({
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        extensions: [ExtensionType.TransferFeeConfig],
        extensionIxs: (mk) => [createInitializeTransferFeeConfigInstruction(mk, payer.publicKey, payer.publicKey, 100, BigInt(1_000_000), TOKEN_2022_PROGRAM_ID)],
      });
      await expectAnchorError(initFor(m, TOKEN_2022_PROGRAM_ID), "UnsupportedMintExtension");
    });

    it("F3: rejects a Token-2022 mint with a PermanentDelegate (could drain the vault)", async () => {
      const m = await makeMint({
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        extensions: [ExtensionType.PermanentDelegate],
        extensionIxs: (mk) => [createInitializePermanentDelegateInstruction(mk, payer.publicKey, TOKEN_2022_PROGRAM_ID)],
      });
      await expectAnchorError(initFor(m, TOKEN_2022_PROGRAM_ID), "UnsupportedMintExtension");
    });

    it("F3: still accepts a Token-2022 mint with only MetadataPointer (the planned migration mint)", async () => {
      const m = await makeMint({
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        extensions: [ExtensionType.MetadataPointer],
        extensionIxs: (mk) => [createInitializeMetadataPointerInstruction(mk, payer.publicKey, mk, TOKEN_2022_PROGRAM_ID)],
      });
      await initFor(m, TOKEN_2022_PROGRAM_ID);
      const [p] = PublicKey.findProgramAddressSync([Buffer.from("lock_pool"), m.toBuffer()], program.programId);
      expect((await program.account.lockPool.fetch(p)).mint.equals(m)).to.be.true;
    });
  });
});

function MAX_COOLDOWN_PLUS_ONE(): number {
  return 30 * DAY + 1;
}
