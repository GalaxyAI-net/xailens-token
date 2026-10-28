import type { PublicKey } from "@solana/web3.js";

/** Decoded `LockPool` account. */
export interface LockPoolInfo {
  authority: PublicKey;
  pendingAuthority: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  cooldownPeriod: number;
  /** Raw amounts (6 decimals). 0 = threshold disabled. */
  discountThreshold: bigint;
  founderThreshold: bigint;
  votingThreshold: bigint;
  totalLocked: bigint;
  paused: boolean;
}

/** Decoded `LockAccount` for one wallet. All timestamps are unix seconds, 0 = unset. */
export interface LockAccountInfo {
  owner: PublicKey;
  amount: bigint;
  lockedSince: number;
  lastDepositAt: number;
  discountSince: number;
  founderSince: number;
  votingSince: number;
  unlockRequestedAt: number;
  unlockCooldown: number;
}

/** Result of the eligibility helpers. */
export interface Eligibility {
  /** Discount applies to the next billing cycle. */
  discount: boolean;
  /** Founder-level benefits unlocked. */
  founder: boolean;
  /** Number of feature votes this wallet currently has (0..MAX_VOTES_PER_WALLET). */
  votes: number;
}

export type SubscriptionPlan = "xEnthusiast" | "xSupporter" | "xInvestor";
