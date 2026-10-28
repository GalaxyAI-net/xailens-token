import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";

import { getEligibility, getVotes, isDiscountEligible, isFounderEligible, discountPercent, xgoldGrant } from "./eligibility.js";
import { DISCOUNT_HOLD_SECONDS, MAX_VOTES_PER_WALLET, VOTING_HOLD_SECONDS } from "./constants.js";
import { toRawAmount, toUiAmount } from "./token.js";
import type { LockAccountInfo, LockPoolInfo } from "./types.js";

const DAY = 24 * 3600;
const T0 = 1_800_000_000;
const raw = (ui: number) => toRawAmount(ui);

const pool: LockPoolInfo = {
  authority: PublicKey.default,
  pendingAuthority: PublicKey.default,
  mint: PublicKey.default,
  vault: PublicKey.default,
  cooldownPeriod: 7 * DAY,
  discountThreshold: raw(1_000),
  founderThreshold: raw(50_000),
  votingThreshold: raw(100_000),
  totalLocked: 0n,
  paused: false,
};

function acc(over: Partial<LockAccountInfo>): LockAccountInfo {
  return {
    owner: PublicKey.default,
    amount: 0n,
    lockedSince: 0,
    lastDepositAt: 0,
    discountSince: 0,
    founderSince: 0,
    votingSince: 0,
    unlockRequestedAt: 0,
    unlockCooldown: 0,
    ...over,
  };
}

test("discount needs 25 full days", () => {
  const a = acc({ amount: raw(1_000), discountSince: T0 });
  assert.equal(isDiscountEligible(a, T0 + 24 * DAY), false);
  assert.equal(isDiscountEligible(a, T0 + DISCOUNT_HOLD_SECONDS - 1), false);
  assert.equal(isDiscountEligible(a, T0 + DISCOUNT_HOLD_SECONDS), true);
  assert.equal(isDiscountEligible(a, T0 + 40 * DAY), true);
});

test("no discount when the clock never started or an unlock is pending", () => {
  assert.equal(isDiscountEligible(acc({ amount: raw(999) }), T0 + 100 * DAY), false);
  const pending = acc({ amount: raw(1_000), discountSince: T0, unlockRequestedAt: T0 + 30 * DAY });
  assert.equal(isDiscountEligible(pending, T0 + 40 * DAY), false);
});

test("founder clock is independent from the discount clock", () => {
  const a = acc({ amount: raw(50_000), discountSince: T0, founderSince: T0 + 10 * DAY });
  assert.equal(isDiscountEligible(a, T0 + 26 * DAY), true);
  assert.equal(isFounderEligible(a, T0 + 26 * DAY), false);
  assert.equal(isFounderEligible(a, T0 + 35 * DAY), true);
});

test("votes need 6 months and scale with amount, capped at 10", () => {
  const base = { amount: raw(100_000), votingSince: T0 };
  assert.equal(getVotes(acc(base), pool, T0 + 179 * DAY), 0);
  assert.equal(getVotes(acc(base), pool, T0 + VOTING_HOLD_SECONDS), 1);
  assert.equal(getVotes(acc({ ...base, amount: raw(350_000) }), pool, T0 + 200 * DAY), 3);
  assert.equal(getVotes(acc({ ...base, amount: raw(1_000_000) }), pool, T0 + 200 * DAY), MAX_VOTES_PER_WALLET);
  assert.equal(getVotes(acc({ ...base, amount: raw(50_000_000) }), pool, T0 + 200 * DAY), MAX_VOTES_PER_WALLET);
  assert.equal(getVotes(acc({ ...base, amount: raw(99_999) }), pool, T0 + 200 * DAY), 0);
});

test("voting disabled when the pool threshold is 0", () => {
  const a = acc({ amount: raw(1_000_000), votingSince: T0 });
  assert.equal(getVotes(a, { votingThreshold: 0n }, T0 + 400 * DAY), 0);
});

test("getEligibility handles a missing account", () => {
  assert.deepEqual(getEligibility(null, pool, T0), { discount: false, founder: false, votes: 0 });
});

test("amount conversions are exact", () => {
  assert.equal(toRawAmount(1), 1_000_000n);
  assert.equal(toRawAmount("0.000001"), 1n);
  assert.equal(toRawAmount("123456789.123456789"), 123456789123456n);
  assert.equal(toUiAmount(1_500_000n), 1.5);
  assert.throws(() => toRawAmount("-1"));
  assert.throws(() => toRawAmount("abc"));
});

test("discount percent and XGold grant follow the eligibility levels", () => {
  assert.equal(discountPercent({ discount: false, founder: false, votes: 0 }), 0);
  assert.equal(discountPercent({ discount: true, founder: false, votes: 0 }), 10);
  assert.equal(xgoldGrant({ discount: false, founder: false, votes: 0 }), 0);
  assert.equal(xgoldGrant({ discount: true, founder: false, votes: 0 }), 10);
  assert.equal(xgoldGrant({ discount: true, founder: true, votes: 3 }), 100);
});
