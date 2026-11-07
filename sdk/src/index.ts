/**
 * @xailens/solana-sdk
 *
 * TypeScript SDK for the XAILENS token (legacy SPL at launch, Token-2022 after
 * migration) and the xailens-lock program.
 */
export * from "./constants.js";
export type { LockPoolInfo, LockAccountInfo, Eligibility, SubscriptionPlan } from "./types.js";
export {
  toRawAmount,
  toUiAmount,
  getXailensBalance,
  getXailensMintInfo,
  createXailensTransferInstruction,
  getTokenProgramForMint,
  assertSupportedTokenProgram,
} from "./token.js";
export type { XailensMintInfo } from "./token.js";
export { heldFor, isDiscountEligible, isFounderEligible, getVotes, getEligibility, discountPercent, xgoldGrant } from "./eligibility.js";
export { LockClient, lockPoolAddress, lockAccountAddress } from "./lock.js";
export type { LockClientOptions } from "./lock.js";
