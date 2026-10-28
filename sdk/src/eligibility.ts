/**
 * Pure helpers that turn on-chain lock state into platform entitlements.
 *
 * These run server-side. Never trust a frontend-reported balance; fetch the
 * lock account from RPC and pass it here.
 */
import {
  DISCOUNT_HOLD_SECONDS,
  DISCOUNT_PERCENT,
  MAX_VOTES_PER_WALLET,
  VOTES_PER_THRESHOLD,
  VOTING_HOLD_SECONDS,
  XGOLD_GRANT,
} from "./constants.js";
import type { Eligibility, LockAccountInfo, LockPoolInfo } from "./types.js";

/** True when `since` is set, no unlock is pending, and `holdSeconds` have elapsed by `now`. */
export function heldFor(acc: LockAccountInfo, since: number, holdSeconds: number, now: number): boolean {
  if (since <= 0) return false;
  if (acc.unlockRequestedAt !== 0) return false;
  return now - since >= holdSeconds;
}

/**
 * Discount for the next monthly cycle: the discount threshold must have been
 * met for at least 25 consecutive days at `now` (use the billing timestamp).
 */
export function isDiscountEligible(acc: LockAccountInfo, now: number, holdSeconds = DISCOUNT_HOLD_SECONDS): boolean {
  return heldFor(acc, acc.discountSince, holdSeconds, now);
}

/** Founder-level benefits use the same 25-day rule on the Founder threshold. */
export function isFounderEligible(acc: LockAccountInfo, now: number, holdSeconds = DISCOUNT_HOLD_SECONDS): boolean {
  return heldFor(acc, acc.founderSince, holdSeconds, now);
}

/**
 * Feature votes: requires the voting threshold held for 6 months. Votes scale
 * with the locked amount (one vote per threshold) and are capped per wallet.
 */
export function getVotes(acc: LockAccountInfo, pool: Pick<LockPoolInfo, "votingThreshold">, now: number, holdSeconds = VOTING_HOLD_SECONDS): number {
  if (pool.votingThreshold <= 0n) return 0;
  if (!heldFor(acc, acc.votingSince, holdSeconds, now)) return 0;
  const multiples = Number(acc.amount / pool.votingThreshold);
  return Math.min(MAX_VOTES_PER_WALLET, multiples * VOTES_PER_THRESHOLD);
}

export function getEligibility(acc: LockAccountInfo | null, pool: LockPoolInfo, now: number): Eligibility {
  if (!acc) return { discount: false, founder: false, votes: 0 };
  return {
    discount: isDiscountEligible(acc, now),
    founder: isFounderEligible(acc, now),
    votes: getVotes(acc, pool, now),
  };
}

/** Discount percent to apply to the next cycle (0 when not eligible). */
export function discountPercent(e: Eligibility): number {
  return e.discount ? DISCOUNT_PERCENT : 0;
}

/** XGold to grant for the following month: Founder level supersedes the discount level. */
export function xgoldGrant(e: Eligibility): number {
  if (e.founder) return XGOLD_GRANT.founder;
  if (e.discount) return XGOLD_GRANT.discount;
  return 0;
}
