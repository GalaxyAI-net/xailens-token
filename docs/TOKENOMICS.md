# XAILENS Tokenomics

Status: **decided 2026-10-29 (launchpad scenario), not yet deployed on mainnet**. Nothing in this document is a price prediction or a promise of returns. Devnet addresses for the public review window are in README.md.

---

## 1. Token specification

| Property | Value |
| --- | --- |
| Name / symbol | XAILENS / XAILENS |
| Network | Solana |
| Token program | **Launch: legacy SPL Token** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) with immutable Metaplex metadata, chosen because Token-2022 support could not be confirmed by every tool in the launch window. Migration to Token-2022 in months 7–9 per section 1.1. |
| Decimals | 6 |
| Total supply | 500,000,000, minted once at TGE |
| Mint authority | Revoked immediately after the initial mint (`scripts/revoke-authority.ts`) |
| Freeze authority | Never set |
| Metadata update authority | Token-2022: revoked after metadata is final. Legacy SPL: metadata created immutable (`isMutable = false`), no authority exists. |
| Transfer fee / hook / permanent delegate / blacklist / pause | None. The mint uses no Token-2022 extension other than metadata. |

Supply cannot be increased, no holder can be frozen, and no transfer tax exists. All three properties are verifiable with `npx tsx scripts/verify-authorities.ts <mint>` on either token program.

### 1.1 Token standard and migration to Token-2022

Decision (2026-10-28): launch on legacy SPL. Raydium CPMM, Streamflow and every wallet support it without caveats, which removes an unknown from a one-week launch window. The `xailens-lock` program, the SDK and the scripts work with both token programs, so nothing changes in code when the migration happens.

Migration to Token-2022 is scheduled for months 7–9 (LITEPAPER section 5), executed as follows:

1. Mint a new Token-2022 mint with the same 500,000,000 supply, same name and symbol, metadata locked, mint authority revoked at creation of the swap.
2. Deploy an open-source, audited-by-review one-way swap program: it burns legacy tokens (or sends them to a dead address if burn is unavailable) and releases Token-2022 tokens 1:1 from an escrow that holds the entire new supply. No admin withdrawal path, no deadline on the swap.
3. Re-create liquidity on the new mint, lock LP, publish both mint addresses and the swap address, and keep the legacy mint listed as "migrated" in README.md.
4. Entitlements switch to the new mint after a published date; lock accounts on the old mint keep their clocks until the holder migrates (the lock program is initialised once per mint).

No holder loses supply share in the migration, and the total supply stays 500,000,000 across both mints at all times.

---

## 2. What the token does

XAILENS is a utility token for the xAILens trading-intelligence platform. It has four functions, and only these four:

1. **Subscription discount.** A wallet that keeps at least the *discount threshold* locked in the `xailens-lock` program for 25 consecutive days receives a discount on the next monthly subscription cycle (plans: xEnthusiast 99 XGold, xSupporter 399 XGold, xInvestor 1,999 XGold per month). The lock must still be in place and not in unlock cooldown on the billing date.
2. **Feature governance.** A wallet that has kept at least 100,000 XAILENS locked for 6 months can vote on feature priorities and submit feature requests. One vote per 100,000 locked, capped at **10 votes per wallet** regardless of balance.
3. **Founder-level benefits.** A wallet that keeps at least the *Founder threshold* locked for 25 consecutive days unlocks priority access, API access and roadmap votes.
4. **Payment for services.** XAILENS is accepted as payment for xAILens services alongside XGold (platform points). Holders may also be granted XGold for the following month as a loyalty benefit.

Explicitly **not** part of the design: revenue share, dividends, buybacks, burn commitments, staking yield, lending, any claim on the company. The lock program emits no tokens. XGold is not a token: it is a non-transferable account credit (1 XGold = 1 USD of service credit) that can only be spent on subscriptions.

**Trading signals are never published on, through, or about the XAILENS token.** The token is not a signal, an index of signals, or a way to access signals that are not available to a paying subscriber without tokens.

### How utility drives demand

- Every paying subscriber has a reason to acquire and *keep locked* the discount threshold, and locked tokens are out of circulation for at least 25 days plus the unlock cooldown (7 days by default, hard capped at 30 days in the program).
- Governance and Founder access scale with locked amount and holding time, not with trading activity.
- Tokens received by the company as payment for services go to the treasury multisig and are used for ecosystem rewards; they are not resold on the open market without a published schedule (see D6).

Demand is bounded by subscription usage. The model does not assume price appreciation.

---

## 3. Allocation

Decided 2026-10-29 (launchpad scenario, replaces the 2026-10-28 private-only draft). Machine-readable copy: `config/allocations.json` (consumed by `scripts/distribute.ts`).

| Bucket | Share | Tokens | TGE unlock | Cliff | Vesting after cliff | Custody |
| --- | --- | --- | --- | --- | --- | --- |
| Private round (KOL, angels) | 8% | 40,000,000 | 10% | none | linear 6 months | Streamflow streams from deployer |
| Public sale (launchpad) | 10% | 50,000,000 | 25% | none | linear 3 months (or the launchpad's standard) | Launchpad claim contract |
| Liquidity | 14% | 70,000,000 | 25,000,000 into the Raydium CPMM pool at TGE | n/a | remaining 45,000,000 held in the multisig for later venues | Squads vault; LP locked 12 months (Streamflow) |
| Team | 14% | 70,000,000 | 0% | 12 months | linear 24 months | Streamflow streams |
| Advisors | 3% | 15,000,000 | 0% | 6 months | linear 12 months | Streamflow streams |
| Ecosystem and community rewards | 26% | 130,000,000 | 5% | none | linear 36 months | Squads vault, released monthly |
| Treasury and operations | 25% | 125,000,000 | 5% | none | linear 24 months | Squads vault, released monthly |
| **Total** | **100%** | **500,000,000** | | | | |

Checks against reviewer guard rails:

- Team + advisors + private + public = 35% (limit 35%).
- Team unlock 0% at TGE, 12-month cliff.
- Circulating at TGE about 54.2M tokens, 10.8% (target 10–20%).
- Private round unlocks linearly from TGE with no cliff and public sale tokens vest over 3 months; both are disclosed to participants and are the only unlocks inside the first 90 days.
- Public price is 2.0x the private price (limit 5x).

---

## 4. Rounds and pricing

| Round | Price (USD) | Tokens | Raise (USD) | Terms |
| --- | --- | --- | --- | --- |
| Private (KOL, angels) | 0.01 | 40,000,000 | up to 400,000 | Open 3 November 2026 to 15 January 2027 (closes earlier if filled). 10% at TGE, linear 6 months via Streamflow; token purchase agreement signed by wallet, provided to participants. Contributions are held untouched in a dedicated, published USDC wallet until TGE; full refund if TGE has not happened by 28 February 2027. |
| Public (launchpad) | 0.02 | 50,000,000 | up to 1,000,000 | Target 500,000 via Polkastarter, remainder via a second launchpad or community sale; 25% at TGE, linear 3 months |
| Pool | opens at 0.02 | 25,000,000 + 500,000 USDC | n/a | Raydium CPMM XAILENS/USDC, LP locked 12 months |

Use of proceeds (1,400,000 USD if both rounds fill): liquidity 36%, engineering and research hires 30%, market data and GPU infrastructure 14%, community and listings 12%, legal entity and audit 8%. Subscription revenue continues to cover part of operations. If the public round does not fill, liquidity is funded first and the other lines scale down in that order.

### Fully diluted valuation

FDV at the public price: 0.02 × 500,000,000 = **10,000,000 USD**. Market cap of the circulating 54.2M tokens at that price: about 1.08M USD. These are arithmetic, not forecasts; the pool price moves with trading.

| Pool price (USD) | FDV (USD) |
| --- | --- |
| 0.01 | 5,000,000 |
| 0.02 | 10,000,000 |
| 0.04 | 20,000,000 |
| 0.10 | 50,000,000 |

---

## 5. Vesting enforcement

- Team, advisor and private allocations are vested with **Streamflow** streams created from the deployer wallet at TGE (`scripts/create-vesting-streams.ts`). Each stream is non-cancellable and its address is published in README.md.
- Public sale tokens are delivered through the launchpad's claim contract on the launchpad's vesting terms.
- Liquidity LP tokens (Raydium CPMM) are locked for 12 months with Streamflow; the lock address is published in README.md.
- Ecosystem and treasury buckets sit in the Squads 2-of-3 vault; releases follow the monthly schedule above and are announced 48 hours before execution. Treasury tokens are sold, if at all, only on that schedule.
- Nothing in this repository enforces vesting by itself. The `xailens-lock` program is for holder utility, not for team vesting.

---

## 6. Circulating supply timeline

Computed from section 3 (liquidity reserve of 45M counted as locked until used).

| Period | Circulating | % of supply |
| --- | --- | --- |
| Month 0 | 54.2M | 10.8% |
| Month 3 | 134.9M | 27.0% |
| Month 6 | 178.0M | 35.6% |
| Month 12 | 235.8M | 47.2% |
| Month 18 | 311.1M | 62.2% |
| Month 24 | 378.8M | 75.8% |
| Month 36 | 455.0M | 91.0% |

Largest single-month release is in months 1–3 when the public, private, ecosystem and treasury streams overlap: about 28M tokens (5.6%) per month, disclosed in the sale terms.

---

## 7. Decisions (closed 2026-10-28)

| # | Decision |
| --- | --- |
| D1 | Allocation as in section 3 (launchpad scenario, 2026-10-29). |
| D2 | Private 0.01 USD for 40M (up to 400,000 USD); public 0.02 USD for 50M (up to 1,000,000 USD, 500,000 targeted via Polkastarter); pool opens at 0.02 USD with 25M + 500,000 USDC. FDV 10,000,000 USD. |
| D3 | Discount threshold 10,000 XAILENS locked 25 days: 10% off every plan for the next cycle. |
| D4 | Founder threshold 100,000 XAILENS locked 25 days: priority access, API access, roadmap votes. |
| D5 | XGold grant, usable the following month only, non-cumulative: 10 XGold at the discount threshold, 100 XGold at the Founder threshold. Cost is service margin, not tokens. |
| D6 | XAILENS received as payment goes to the treasury vault and is recycled into ecosystem rewards. No burn. |
| D7 | Legacy SPL at launch; Token-2022 migration months 7–9. |
| D8 | LP locked 12 months via Streamflow. |
| D9 | One Squads 2-of-3 vault for all buckets: founder, one research-team member, one private-round participant with a public reputation. |
