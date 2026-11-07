import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, BN, Program, type Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { LOCK_PROGRAM_ID } from "./constants.js";
import { getEligibility } from "./eligibility.js";
import type { Eligibility, LockAccountInfo, LockPoolInfo } from "./types.js";
import { getTokenProgramForMint, toRawAmount } from "./token.js";
import type { XailensLock } from "./idl/xailens_lock.js";
import rawIdl from "./idl/xailens_lock.json";

const POOL_SEED = Buffer.from("lock_pool");
const LOCK_SEED = Buffer.from("lock");

/** Read-only wallet used when the caller only needs to fetch accounts. */
class ReadOnlyWallet implements Wallet {
  constructor(readonly publicKey: PublicKey) {}
  get payer(): never {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  async signTransaction<T>(_tx: T): Promise<T> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  async signAllTransactions<T>(_txs: T[]): Promise<T[]> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
}

/** PDA of the lock pool for `mint` (one pool per mint). */
export function lockPoolAddress(mint: PublicKey, programId: PublicKey = LOCK_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([POOL_SEED, mint.toBuffer()], programId)[0];
}

/** PDA of `owner`'s lock position in `pool`. */
export function lockAccountAddress(pool: PublicKey, owner: PublicKey, programId: PublicKey = LOCK_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([LOCK_SEED, pool.toBuffer(), owner.toBuffer()], programId)[0];
}

export interface LockClientOptions {
  /** XAILENS mint whose pool this client reads (one pool per mint). */
  mint: PublicKey;
  /** Needed only to sign; reads work without one. */
  wallet?: Wallet;
  programId?: PublicKey;
  /**
   * Optional expectation. The token program is always read from the mint's
   * on-chain owner; if this is set and disagrees, the builders throw.
   */
  tokenProgramId?: PublicKey;
}

/**
 * Client for the xailens-lock pool of one mint.
 *
 * Reads work without a wallet. Instruction builders return instructions for
 * the caller to sign and send (the SDK never holds keys).
 */
export class LockClient {
  readonly program: Program<XailensLock>;
  readonly programId: PublicKey;
  readonly mint: PublicKey;
  readonly poolAddress: PublicKey;
  /** Expected token program, if the caller pinned one. */
  readonly expectedTokenProgramId?: PublicKey;

  constructor(readonly connection: Connection, opts: LockClientOptions) {
    this.programId = opts.programId ?? LOCK_PROGRAM_ID;
    this.mint = opts.mint;
    this.expectedTokenProgramId = opts.tokenProgramId;
    const provider = new AnchorProvider(connection, opts.wallet ?? new ReadOnlyWallet(PublicKey.default), {
      commitment: "confirmed",
    });
    const idl = { ...(rawIdl as XailensLock), address: this.programId.toBase58() } as XailensLock;
    this.program = new Program<XailensLock>(idl, provider);
    this.poolAddress = lockPoolAddress(this.mint, this.programId);
  }

  lockAccountAddress(owner: PublicKey): PublicKey {
    return lockAccountAddress(this.poolAddress, owner, this.programId);
  }

  async getPool(): Promise<LockPoolInfo> {
    const p = await this.program.account.lockPool.fetch(this.poolAddress);
    return {
      authority: p.authority,
      pendingAuthority: p.pendingAuthority,
      mint: p.mint,
      vault: p.vault,
      cooldownPeriod: p.cooldownPeriod.toNumber(),
      discountThreshold: BigInt(p.discountThreshold.toString()),
      founderThreshold: BigInt(p.founderThreshold.toString()),
      votingThreshold: BigInt(p.votingThreshold.toString()),
      totalLocked: BigInt(p.totalLocked.toString()),
      paused: p.paused,
    };
  }

  /** Null when the wallet has never locked (or closed its account). */
  async getLockAccount(owner: PublicKey): Promise<LockAccountInfo | null> {
    const a = await this.program.account.lockAccount.fetchNullable(this.lockAccountAddress(owner));
    if (!a) return null;
    if (!a.owner.equals(owner) || !a.pool.equals(this.poolAddress)) {
      throw new Error("lock account does not belong to this owner and pool");
    }
    return {
      owner: a.owner,
      pool: a.pool,
      amount: BigInt(a.amount.toString()),
      lockedSince: a.lockedSince.toNumber(),
      lastDepositAt: a.lastDepositAt.toNumber(),
      discountSince: a.discountSince.toNumber(),
      founderSince: a.founderSince.toNumber(),
      votingSince: a.votingSince.toNumber(),
      unlockRequestedAt: a.unlockRequestedAt.toNumber(),
      unlockCooldown: a.unlockCooldown.toNumber(),
    };
  }

  /** Server-side entitlement check for a wallet at `now` (unix seconds, default: current time). */
  async getEligibility(owner: PublicKey, now: number = Math.floor(Date.now() / 1000)): Promise<Eligibility> {
    const [pool, acc] = await Promise.all([this.getPool(), this.getLockAccount(owner)]);
    return getEligibility(acc, pool, now);
  }

  /**
   * Token program that owns `mint` on-chain (legacy SPL or Token-2022). Never
   * taken from configuration, so the builders keep working across the
   * Token-2022 migration.
   */
  async getTokenProgramId(mint: PublicKey = this.mint): Promise<PublicKey> {
    const owner = await getTokenProgramForMint(this.connection, mint);
    if (this.expectedTokenProgramId && !this.expectedTokenProgramId.equals(owner)) {
      throw new Error(`mint is owned by token program ${owner.toBase58()}, expected ${this.expectedTokenProgramId.toBase58()}`);
    }
    return owner;
  }

  // ------------------------------------------------------------------ builders

  async buildLockIx(user: PublicKey, uiAmount: number | string): Promise<TransactionInstruction> {
    const pool = await this.getPool();
    const tokenProgram = await this.getTokenProgramId(pool.mint);
    return this.program.methods
      .lock(new BN(toRawAmount(uiAmount).toString()))
      .accounts({
        user,
        mint: pool.mint,
        userTokenAccount: getAssociatedTokenAddressSync(pool.mint, user, false, tokenProgram),
        vault: pool.vault,
        tokenProgram,
      })
      .instruction();
  }

  async buildRequestUnlockIx(user: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.requestUnlock().accountsPartial({ user, pool: this.poolAddress }).instruction();
  }

  async buildWithdrawIx(user: PublicKey): Promise<TransactionInstruction> {
    const pool = await this.getPool();
    const tokenProgram = await this.getTokenProgramId(pool.mint);
    return this.program.methods
      .withdraw()
      .accounts({
        user,
        mint: pool.mint,
        userTokenAccount: getAssociatedTokenAddressSync(pool.mint, user, false, tokenProgram),
        vault: pool.vault,
        tokenProgram,
      })
      .instruction();
  }

  async buildCloseLockAccountIx(user: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.closeLockAccount().accountsPartial({ user, pool: this.poolAddress }).instruction();
  }
}
