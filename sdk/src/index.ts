/**
 * @xailens/solana-sdk
 *
 * TypeScript SDK for the XAILENS token (Token-2022) and the xailens-lock program.
 */
export * from "./constants.js";
export type { LockPoolInfo, LockAccountInfo, Eligibility, SubscriptionPlan } from "./types.js";
export {
  toRawAmount,
  toUiAmount,
  getXailensBalance,
  getXailensMintInfo,
  createXailensTransferInstruction,
} from "./token.js";
export type { XailensMintInfo } from "./token.js";
export { heldFor, isDiscountEligible, isFounderEligible, getVotes, getEligibility, discountPercent, xgoldGrant } from "./eligibility.js";
export { LockClient } from "./lock.js";
