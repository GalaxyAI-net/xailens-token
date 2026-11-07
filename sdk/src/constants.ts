import { PublicKey } from "@solana/web3.js";

import lockIdl from "./idl/xailens_lock.json";

// ---------------------------------------------------------------------------
// Token basics
// ---------------------------------------------------------------------------

/** On-chain decimals of the XAILENS token. */
export const XAILENS_DECIMALS = 6;

/** Fixed total supply (UI amount). Mint authority is revoked after the initial mint. */
export const XAILENS_TOTAL_SUPPLY = 500_000_000;

/** Token-2022 program ID. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** Legacy SPL Token program ID (fallback launch standard, see TOKENOMICS D7). */
export const LEGACY_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// The token program is never configured: read it from the mint's owner with
// `getTokenProgramForMint` (launch: legacy SPL; Token-2022 migration months 7–9).

/**
 * XAILENS mint address.
 *
 * PLACEHOLDER (System Program) until the token is deployed. Set
 * `XAILENS_MINT` env var or pass the mint explicitly to the helpers.
 */
export const XAILENS_MINT = new PublicKey("11111111111111111111111111111111");

/**
 * xailens-lock program ID, read from the bundled IDL so it always matches
 * `declare_id!` (copy `target/idl/xailens_lock.json` into `sdk/src/idl/`
 * after `anchor keys sync` + `anchor build`).
 */
export const LOCK_PROGRAM_ID = new PublicKey(lockIdl.address);

/** Deployer wallet (initial mint authority, revoked after TGE). */
export const OWNER_WALLET = new PublicKey("3qqAyWYZ3vGNA2nHw25Yp1bR3eiGRRmfjLgT3S7eWdne");

// ---------------------------------------------------------------------------
// Utility rules (agreed 2026-10-28)
// ---------------------------------------------------------------------------

const DAY = 24 * 3600;

/** Tokens must be locked for 25 consecutive days to earn the discount on the next monthly subscription. */
export const DISCOUNT_HOLD_SECONDS = 25 * DAY;

/** Tokens must be locked above the voting threshold for 6 months to vote on features. */
export const VOTING_HOLD_SECONDS = 180 * DAY;

/** Lock threshold for feature voting (UI amount). */
export const VOTING_THRESHOLD = 100_000;

/** Votes per `VOTING_THRESHOLD` locked. One wallet can never exceed `MAX_VOTES_PER_WALLET`. */
export const VOTES_PER_THRESHOLD = 1;
export const MAX_VOTES_PER_WALLET = 10;

/** Lock threshold for the subscription discount (UI amount). The on-chain pool value is authoritative. */
export const DISCOUNT_THRESHOLD = 10_000;

/** Discount applied to every plan for the next cycle when the discount rule is met. */
export const DISCOUNT_PERCENT = 10;

/** Lock threshold for Founder-level benefits (UI amount). The on-chain pool value is authoritative. */
export const FOUNDER_THRESHOLD = 100_000;

/** XGold granted for the following month (non-cumulative) at each level. */
export const XGOLD_GRANT = { discount: 10, founder: 100 } as const;

/** Unlock cooldown in seconds (7 days). Hard cap in the program is 30 days. */
export const DEFAULT_COOLDOWN_SECONDS = 7 * DAY;

/** Subscription prices in XGold (platform points, 1 XGold = 1 USD of credit). */
export const SUBSCRIPTION_PRICES_XGOLD = {
  xEnthusiast: 99,
  xSupporter: 399,
  xInvestor: 1_999,
} as const;
