# XAILENS Token

Utility token for the [xAILens](https://xailens.com) trading-intelligence platform, on Solana.

Status: **not deployed**. This repository holds the on-chain program, SDK, TGE scripts and the documents prepared for launchpad and venue review. The program is reviewed publicly rather than by a paid audit (see docs/SECURITY.md section 4). Nothing below is live until an address appears in the "Deployed addresses" table.

## What the token does

| Utility | Rule |
| --- | --- |
| Subscription discount | Lock at least 10,000 XAILENS for 25 consecutive days before a billing date: 10% off every plan for the next monthly cycle, plus 10 XGold. |
| Feature governance | Lock at least 100,000 XAILENS for 6 months: vote on feature priorities and submit feature requests. One vote per 100,000 locked, maximum 10 votes per wallet. |
| Founder-level benefits | Lock at least 100,000 XAILENS for 25 consecutive days: priority access, API access, roadmap votes, plus 100 XGold. |
| Payment | XAILENS is accepted for xAILens services. Holders may be granted XGold (platform points) for the following month. |

No revenue share, no buyback, no yield, no price claims. Trading signals are never published on or about the token. Full design: [docs/LITEPAPER.md](docs/LITEPAPER.md), [docs/TOKENOMICS.md](docs/TOKENOMICS.md), [docs/SECURITY.md](docs/SECURITY.md).

## Token details

| Property | Value |
| --- | --- |
| Network | Solana |
| Token program | Legacy SPL with immutable Metaplex metadata at launch; published 1:1 migration to Token-2022 in months 7–9 (docs/TOKENOMICS.md section 1.1). Program, SDK and scripts support both. |
| Decimals | 6 |
| Total supply | 500,000,000, fixed |
| Mint authority | revoked at TGE |
| Freeze authority | never set |
| Metadata | immutable from creation (Metaplex `isMutable = false`) |
| Transfer fee, hook, blacklist, pause | none |

## Devnet (public review window)

Deployed 2026-10-28 from the build at this commit. Review window: **2026-10-28 to 2026-11-27** (30 days). Target TGE: **2027-01-29 15:00 UTC**.

| Resource | Address |
| --- | --- |
| `xailens-lock` program (devnet) | `6urQa7RwSR1nW9tbYkGpaLznWL7WuFSmGHmwJZWcXTA9` |
| Lock pool PDA | `HoZrUEG6Q28pN6jPUZ2nfWWbHQodDae2HSTwZNph9QtX` |
| Pool vault | `AKJHTok7W6EhKyRymn7Bd5k4DCmFc6uDAqRovAG7XjsK` |
| Test mint (legacy SPL, mint authority revoked, metadata immutable) | `Dhq4D5tbcBtuJ4VZezRdrPQrojv3tzUkXQt4u1x8VN5J` |
| Devnet deployer / upgrade authority (throwaway key, devnet only) | `4XEerefXARRJmA4HfKwU3b9KWRQJCiZoGtyvQTHSD8tR` |
| Streamflow stream (Team, test recipient, 1,000 tokens) | `D18BpJyFh6474vjRd8GKWdqKi3ufUgFmSo8pQabpkqYi` |
| Streamflow stream (Private round, test recipient, 1,000 tokens) | `Bb3S9F5Dh65AjHB2ofG7NyANAWE2G2tZaPyCdd65MxUV` |

Pool parameters: cooldown 7 days, discount threshold 10,000, Founder threshold 100,000, voting threshold 100,000 (raw values ×10⁶ on-chain). The devnet deployer holds a live 100,000-token lock as a demo (`scripts/lock-demo.ts`).

Review invitation: read `programs/xailens-lock/src/lib.rs` against the invariants in `docs/SECURITY.md` section 3, try to break them on devnet, and open an issue at https://github.com/GalaxyAI-net/xailens-token/issues. Anyone can reproduce the build (`anchor build` with the committed lockfiles) and compare the hash with `solana program dump`.

## Deployed addresses (mainnet)

| Resource | Address |
| --- | --- |
| Deployer wallet | `3qqAyWYZ3vGNA2nHw25Yp1bR3eiGRRmfjLgT3S7eWdne` |
| Token mint | TODO (published at TGE) |
| `xailens-lock` program | TODO |
| Treasury multisig (Squads) | TODO |
| Ecosystem multisig (Squads) | TODO |
| Liquidity multisig (Squads) | TODO |
| Team vesting (Streamflow) | TODO |
| Advisor vesting (Streamflow) | TODO |
| Seed / private vesting (Streamflow) | TODO |
| Raydium CPMM pool and LP lock proof | TODO |
| Public review window (devnet) | TODO |

Verify any of them with `npx tsx scripts/verify-authorities.ts <mint>`.

## Repository layout

```
programs/xailens-lock/   Anchor program: lock to prove holding; no rewards (see its README)
sdk/                     @xailens/solana-sdk: balances, lock client, eligibility rules
scripts/                 TGE runbook: create-mint-legacy, distribute, revoke-authority, init-lock-pool, create-vesting-streams, seed-liquidity, verify-authorities, lock-demo
tests/                   localnet integration tests (token authorities, lock program)
config/                  allocations.json (consumed by scripts/distribute.ts), vesting.example.json, devnet stream record
docs/                    LITEPAPER, TOKENOMICS, SECURITY, integration-guide
metadata/                token metadata JSON
```

## Build and test

Toolchain: Rust stable, Solana CLI (Agave) 2.1 or newer, Anchor CLI 0.31.x, Node 20 or newer. Lockfiles (`Cargo.lock`, `package-lock.json`) are committed for reproducible builds.

```bash
npm install
anchor build
anchor keys sync          # first time only: writes your local program id into lib.rs and Anchor.toml
anchor test               # starts a local validator, runs tests/*.test.ts
npm run test:sdk          # SDK unit tests (discount, Founder, voting rules)
npm run typecheck
```

`Anchor.toml` loads the program as upgradeable with the test wallet as upgrade authority, because `initialize` only accepts the upgrade authority. It also moves the validator off port 8000, which is often taken on WSL2 and macOS.

## TGE runbook (devnet first)

Every script defaults to devnet, redacts RPC URLs, and asks for an interactive "yes" on mainnet.

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
npx tsx scripts/create-mint-legacy.ts               # legacy SPL mint, immutable Metaplex metadata, full supply to deployer
# (after the Token-2022 migration: scripts/setup-metadata.ts create)
export XAILENS_MINT=<mint>
npx tsx scripts/distribute.ts --dry-run              # requires config/allocations.json to be final
npx tsx scripts/distribute.ts
# create Streamflow streams for vested buckets (from the deployer wallet), record addresses
npx tsx scripts/revoke-authority.ts $XAILENS_MINT     # revokes mint + metadata authority, irreversible
npx tsx scripts/seed-liquidity.ts --calculate-only
npx tsx scripts/verify-authorities.ts $XAILENS_MINT
# vesting streams + LP lock (copy config/vesting.example.json to private/config/vesting.json and fill it)
npx tsx scripts/create-vesting-streams.ts --dry-run
npx tsx scripts/create-vesting-streams.ts
npx tsx scripts/create-vesting-streams.ts --lp-lock
```

Then `anchor deploy`, `npx tsx scripts/init-lock-pool.ts` from the upgrade authority, move the upgrade authority and pool authority to the Squads multisig (`propose_authority` / `accept_authority`), and publish every address above.

## SDK

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { LockClient, getXailensBalance } from "@xailens/solana-sdk";

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const wallet = new PublicKey("...");

const balance = await getXailensBalance(connection, wallet, mint);
const client = new LockClient(connection, undefined, programId);
const { discount, founder, votes } = await client.getEligibility(wallet); // server-side only
```

See [sdk/README.md](sdk/README.md) and [docs/integration-guide.md](docs/integration-guide.md).

## Links

| | |
| --- | --- |
| Website | https://xailens.com |
| Track record (xInvestor) | https://xailens.com/track-record/xinvestor |
| X | https://x.com/xailens_com |
| Telegram | https://t.me/xailens_community |
| Repository | https://github.com/GalaxyAI-net/xailens-token |

## Security

Report vulnerabilities to security@xailens.com, not in a public issue. Policy: [SECURITY.md](SECURITY.md). Model, multisig plan and audit scope: [docs/SECURITY.md](docs/SECURITY.md).

## License

Apache 2.0. See [LICENSE](LICENSE).

## Disclaimer

XAILENS is a utility token. Nothing in this repository is an offer, investment advice, or a promise of value, price or listing. See [docs/LITEPAPER.md](docs/LITEPAPER.md) section 8.
