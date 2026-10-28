import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, BN, Program, type Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { LOCK_PROGRAM_ID, XAILENS_TOKEN_PROGRAM_ID } from "./constants.js";
import { getEligibility } from "./eligibility.js";
import type { Eligibility, LockAccountInfo, LockPoolInfo } from "./types.js";
import { toRawAmount } from "./token.js";
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

/**
 * Client for the xailens-lock program.
 *
 * Reads work without a wallet. Instruction builders return instructions for
 * the caller to sign and send (the SDK never holds keys).
 */
export class LockClient {
  readonly program: Program<XailensLock>;
  readonly programId: PublicKey;
  readonly poolAddress: PublicKey;

  constructor(
    readonly connection: Connection,
    wallet?: Wallet,
    programId: PublicKey = LOCK_PROGRAM_ID,
    readonly tokenProgramId: PublicKey = XAILENS_TOKEN_PROGRAM_ID,
  ) {
    this.programId = programId;
    const provider = new AnchorProvider(connection, wallet ?? new ReadOnlyWallet(PublicKey.default), {
      commitment: "confirmed",
    });
    const idl = { ...(rawIdl as XailensLock), address: programId.toBase58() } as XailensLock;
    this.program = new Program<XailensLock>(idl, provider);
    [this.poolAddress] = PublicKey.findProgramAddressSync([POOL_SEED], programId);
  }

  lockAccountAddress(owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([LOCK_SEED, owner.toBuffer()], this.programId)[0];
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
    return {
      owner: a.owner,
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

  // ------------------------------------------------------------------ builders

  async buildLockIx(user: PublicKey, uiAmount: number | string): Promise<TransactionInstruction> {
    const pool = await this.getPool();
    return this.program.methods
      .lock(new BN(toRawAmount(uiAmount).toString()))
      .accounts({
        user,
        mint: pool.mint,
        userTokenAccount: getAssociatedTokenAddressSync(pool.mint, user, false, this.tokenProgramId),
        vault: pool.vault,
        tokenProgram: this.tokenProgramId,
      })
      .instruction();
  }

  async buildRequestUnlockIx(user: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.requestUnlock().accounts({ user }).instruction();
  }

  async buildWithdrawIx(user: PublicKey): Promise<TransactionInstruction> {
    const pool = await this.getPool();
    return this.program.methods
      .withdraw()
      .accounts({
        user,
        mint: pool.mint,
        userTokenAccount: getAssociatedTokenAddressSync(pool.mint, user, false, this.tokenProgramId),
        vault: pool.vault,
        tokenProgram: this.tokenProgramId,
      })
      .instruction();
  }

  async buildCloseLockAccountIx(user: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.closeLockAccount().accounts({ user }).instruction();
  }
}
