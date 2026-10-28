# XAILENS Litepaper

Version 0.2, October 2026. Status: draft for launchpad, exchange and fund review. Factual tone by design: no price targets, no return expectations, no unconfirmed listings. Items marked TODO are not yet decided or not yet verifiable.

---

## 1. Problem

Retail and semi-professional traders are flooded with signals and indicators that do not explain themselves. They cannot tell a setup that works in the current regime from one that stopped working, they cannot verify a provider's track record, and when they do subscribe to automated execution they hand their exchange keys and their trade data to a third party.

Three concrete gaps:

1. **No explanation.** Most tools emit "buy" or "sell" with no model of *why*, so the user cannot judge when to stop trusting it.
2. **No verifiable track record.** Performance claims are screenshots.
3. **No privacy in execution.** Copy-trading and bot services run on the provider's servers with the customer's API keys.

## 2. Product: xAILens

xAILens is a live trading-intelligence platform built on an explainable-AI WorldModel stack. It is sold today as a subscription; the token is being added to an existing product, not launched in place of one.

The direction of the platform is a dedicated venue for trade advisory, strategy construction and investment research driven by explainable AI models that the team's in-house research group (MSc and PhD level, see section 6) develops itself, across markets. Crypto (spot and futures) and forex are live today; further markets follow the 12-month roadmap in section 5. "Explainable" is the design constraint: every output ships with the reasoning and the regime assumptions the model used, so a user can audit a call before acting on it.

| Module | What it does |
| --- | --- |
| Safe Zones | Marks price regions where the model's confidence in a directional thesis is low, so users avoid trading into noise. |
| Setup Scanner | Scans markets for setups that match the model's learned regimes and explains each match. |
| Opportunity Finder | Ranks setups by model-estimated edge and regime fit. |
| Trading Signals | Time-stamped entries, invalidation and targets for crypto and forex, each with the reasoning the model used. |
| SENTINEL | Crypto-futures alerting on regime shifts and risk events. Live. |
| xInvestor | An edge client that runs on the customer's own machine. It receives encrypted signals and places trades locally with the customer's own exchange keys. No trade or account data flows back to xAILens servers. |

Subscription plans, billed in XGold (platform points, 1 XGold = 1 USD of credit, non-transferable):

| Plan | Price per month |
| --- | --- |
| xEnthusiast | 99 XGold |
| xSupporter | 399 XGold |
| xInvestor | 1,999 XGold |

xAILens trades its own signals in crypto and forex and publishes the xInvestor track record at https://xailens.com/track-record/xinvestor: every signal sent to the xInvestor group, scored on how the trade closed, in R-multiples, updated automatically. Founder-reported summary as of October 2026: about 20R per month, no negative month over the reporting period (start date TODO), maximum drawdown 20R, where R is one unit of risk per trade as defined by the platform's position sizing. The track record page is produced by xAILens itself from its own signal log. These figures describe the trading product, not the token, they are not a forecast, and past results do not determine future results. Subscriber count and revenue are TODO and will be stated only when independently checkable.

**Signals are never published on the token.** Signals exist only inside the subscription product. Nothing about the XAILENS token, its metadata, its program, or its on-chain events carries trading signals, and holding the token does not grant signals that a paying subscriber without tokens cannot get.

## 3. The XAILENS token

Solana, 6 decimals, 500,000,000 fixed supply. Mint authority revoked at TGE, no freeze authority, metadata immutable. No transfer tax, no blacklist, no pause on transfers. Token standard at launch: legacy SPL with Metaplex metadata; a published, one-way 1:1 migration to Token-2022 is scheduled for months 7–9 (TOKENOMICS section 1.1). Full specification: [TOKENOMICS.md](TOKENOMICS.md); authority model and review approach: [SECURITY.md](SECURITY.md).

### 3.1 Utility

| Utility | Rule | Enforced by |
| --- | --- | --- |
| Subscription discount | Keep at least 10,000 XAILENS locked for 25 consecutive days before a billing date: 10% off every plan for that next monthly cycle, plus 10 XGold for that month. | `xailens-lock` program records when the threshold was first met; the platform verifies server-side. |
| Feature governance | Keep at least 100,000 XAILENS locked for 6 months to vote on feature priorities and submit feature requests. One vote per 100,000 locked, maximum 10 votes per wallet. | Program clock plus platform-side vote tally. |
| Founder-level benefits | Keep at least 100,000 XAILENS locked for 25 consecutive days: priority access, API access, roadmap votes, plus 100 XGold for that month. | Same mechanism. |
| Pay for services | XAILENS is accepted as payment for xAILens services; tokens received go to the treasury multisig and are recycled into ecosystem rewards, never burned. | Platform billing. |

What the token is **not**: it carries no revenue share, no dividend, no buyback or burn commitment, no staking yield, no claim on the company, and no promise of listing on any venue. Locking emits nothing. The lock program's only job is to prove holding over time; the admin cannot block withdrawals.

### 3.2 Why lock instead of a balance snapshot

A balance snapshot can be gamed by borrowing tokens for one block. A 25-day lock with a 7-day unlock cooldown ties the benefit to actual holding, keeps the benefit tokens out of circulation while the benefit is in use, and gives reviewers a clean on-chain record.

## 4. Tokenomics summary

Total supply 500,000,000, fixed. Private round 8% (40M at 0.01 USD, up to 400,000 USD, 10% at TGE then linear 6 months), public sale 10% (50M at 0.02 USD, up to 1,000,000 USD through launchpads, 25% at TGE then linear 3 months), liquidity 14% (25M into a Raydium CPMM pool with 500,000 USDC at the public price, LP locked 12 months; 45M reserved), team 14% (0% at TGE, 12-month cliff, 24-month linear), advisors 3% (6-month cliff, 12-month linear), ecosystem and community rewards 26% (5% at TGE, 36-month linear), treasury 25% (5% at TGE, 24-month linear). FDV at the public price is 10M USD; about 10.8% of supply circulates at TGE. Streams, LP lock and multisig addresses are published in the README. Details and the circulating-supply table: [TOKENOMICS.md](TOKENOMICS.md).

## 5. Roadmap (12 months)

Twelve months because the core product is already live and operating (SENTINEL, crypto and forex signals, the public live account). Quarters are relative to the token generation event (TGE). Product milestones are commitments of the xAILens roadmap; venue names are targets, not confirmed listings.

| Window | Platform | Token |
| --- | --- | --- |
| Pre-TGE (2026-10-28 to 2027-01-29) | Lock and discount UI integrated behind a feature flag. Reviewer demo account. Public live-account link published. | Program on devnet since 2026-10-28, 30-day public review window. Squads 2-of-3 created. Devnet rehearsal of the full TGE runbook done. Private round open 3 November 2026 to 15 January 2027; launchpad applications in parallel; public sale on the launchpad's schedule in the week before TGE. |
| TGE (2027-01-29, 15:00 UTC) | Discount utility live for subscribers. | Public sale on the launchpad in the preceding week. Mint, revoke authorities, distribute (including the launchpad claim allocation), create vesting streams, seed Raydium CPMM liquidity and lock LP, publish all addresses. Lock program on mainnet with authorities on the multisig. |
| Months 1–3 | Founder-level tier live. XGold grants for holders live. Explainability report per signal exportable via API for Founder-level holders. | Advisory vote for TGE holders (the 6-month on-chain rule cannot be met yet). Upgrade authority made immutable after a 14-day bake if no open findings. Bug bounty opened. |
| Months 4–6 | Strategy Builder v1: users compose and backtest strategies from the model's explained setups, crypto and forex. | First on-chain feature vote (wallets that locked at TGE qualify at month 6). Pay-with-XAILENS for all services. If launched on legacy SPL: migration swap program published for review. |
| Months 7–9 | Portfolio-level advisory: position sizing and risk explained by the model across crypto and forex. Research release for the next market (equities or commodities, chosen by the first feature vote). | If launched on legacy SPL: Token-2022 migration executed, liquidity re-created and locked, old mint marked migrated. |
| Months 10–12 | Strategy marketplace for user-built, model-verified strategies (no signal publishing outside the product). Mobile client. | Governance scope extended to ecosystem-bucket release decisions. Review of thresholds by governance vote. Additional DEX pair (XAILENS/SOL) if liquidity supports it. |

Beyond month 12 the roadmap is set by feature votes; nothing beyond this table is promised.

## 6. Team

The founder is public and completes identity verification with any venue that asks. There is no legal entity behind the token yet; the planned issuer is a BVI Business Company, formed once funding is secured, with the existing operating company continuing to run the SaaS (section 7).

| Role | Who |
| --- | --- |
| Founder, product and architecture, research lead | Khoa Dang Nguyen, MSc. Founder of xAILens and GalaxyAI.net; builds the platform and leads the WorldModel research. GitHub: `khoa-nguyendang`, organisation `GalaxyAI-net`. |
| Research group | Four researchers (university lecturers and doctoral candidates) who co-develop the explainable-AI models. They are not named publicly to protect their academic positions; their identities can be shared with a venue under a confidentiality agreement if required. |

What a reviewer can verify today: the live product, the track record page (https://xailens.com/track-record/xinvestor), this repository and its tests, and the devnet deployment. After TGE: the on-chain controls (multisig, locked LP, vesting streams, immutable program).

## 7. Risks

- **Regulatory and structural.** There is no legal entity behind the token yet. The plan is a BVI Business Company as token issuer, formed after the raise succeeds (funded from the "legal entity and audit" line of the use of proceeds); until then the founder contracts personally, which some launchpads may not accept. The SaaS stays with the operating company. A BVI issuer does not remove the founder's personal tax obligations in Vietnam or the exclusion of US persons from the rounds. Vietnam's 2025 pilot regime requires a Vietnamese issuer entity and VND settlement for issuance inside Vietnam; the EU MiCA white-paper exemption for utility tokens is lost once admission to trading is sought; US persons are excluded from all rounds. Without an entity, liability sits with the founder personally and centralised exchanges and equity-style VC deals are out of reach until one exists. The open legal questions are tracked internally for whenever counsel is engaged.
- **No paid audit.** Reviewers cannot rely on a third-party audit report. Mitigations: reproducible open-source build verifiable on-chain, 28 integration tests run on both token programs, a 30-day public devnet review window (2026-10-28 to 2026-11-27), immutable program after a 14-day mainnet bake, withdrawals that cannot be paused, 2-of-3 multisig custody, published vesting and LP locks. These do not replace an audit; they are what the project offers instead.
- **Conflict of interest.** A signal provider issuing its own token could be accused of using signals to move its token. Mitigation written into SECURITY.md and this document: signals are never published on or about the token, the company never trades XAILENS against its own signals, and treasury sales follow a published schedule.
- **Key-person.** One founder carries product, token and operations; the four researchers contribute part-time alongside academic roles. Mitigation: multisig custody from day one, documented runbooks.
- **Smart-contract.** Mitigated by a small program surface (eight instructions, no reward math), public review, immutable upgrade authority after the bake period, and withdrawals that cannot be paused. No paid audit at launch.
- **Market and liquidity.** Token value may go to zero. Nothing in this document assumes otherwise. Liquidity is seeded once and locked; there is no price support.
- **Utility dependency.** Every utility depends on xAILens continuing to operate. If the platform shuts down, the token has no use.
- **Performance claims.** The track record in section 2 is produced by xAILens itself from its own signal log. Trading results can turn negative; the figures are not a forecast for the product and say nothing about the token.
- **Token standard and migration.** If the launch uses legacy SPL, the later Token-2022 migration is a one-way 1:1 swap that holders must perform themselves; liquidity moves to the new mint on a published date. Holders who never migrate keep legacy tokens with no utility after the switch-over date.

## 8. Legal notice

This litepaper is informational. It is not an offer to sell, a solicitation, or investment advice, and it may change. XAILENS is a utility token; no statement here should be read as a promise of profit, price, or listing. Participants are responsible for the laws of their own jurisdiction.
