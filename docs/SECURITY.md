# XAILENS Security

Status: **pre-deployment**. Everything below is the target state. Each item has a verification method so a reviewer can check it on-chain once addresses are published in README.md. Nothing is claimed as done until it is linked there.

---

## 1. Authorities

| Authority | Target state at TGE | How it gets there | How to verify |
| --- | --- | --- | --- |
| Mint authority | Revoked (null) | `scripts/revoke-authority.ts --mint` right after the 500M mint, same session | `scripts/verify-authorities.ts`, Solana Explorer mint page |
| Freeze authority | Never set | `scripts/setup-metadata.ts create` passes `null` | same |
| Metadata update authority | Token-2022: revoked (null). Legacy SPL: metadata immutable at creation, no authority | `scripts/revoke-authority.ts --metadata` (Token-2022) or `scripts/create-mint-legacy.ts` (`isMutable = false`) | same |
| `xailens-lock` upgrade authority | Squads 2-of-3 at launch; set to **none (immutable)** after a 14-day bake period on mainnet with no findings from the public review (section 4) | `solana program set-upgrade-authority` to the Squads vault, later `--final` | `scripts/verify-authorities.ts` with `LOCK_PROGRAM_ID`, `solana program show` |
| `xailens-lock` pool authority | Squads multisig | `propose_authority` from deployer, `accept_authority` executed by the multisig | `LockPool.authority` field |
| Deployer wallet `3qqAyWYZ3vGNA2nHw25Yp1bR3eiGRRmfjLgT3S7eWdne` | Holds nothing of value after distribution | `scripts/distribute.ts` then Streamflow stream creation | Token account balances |

The lock program accepts both Token-2022 and legacy SPL mints (`TokenInterface`), so the token-program decision (TOKENOMICS D7) does not require a program change.

---

## 2. Multisig setup

Platform: Squads Protocol v4.

| Vault | Threshold | Signers | Purpose |
| --- | --- | --- | --- |
| Single vault for treasury, ecosystem, liquidity reserve and program authority | 2-of-3 | Founder; one research-team member; one private-round participant with a public reputation | Everything. One vault because the team is small; the third signer being external is what makes the threshold real. |

Rules: no two signers on the same hardware or in the same physical location for the treasury vault; every signer uses a hardware wallet; a time lock of at least 24 hours on treasury transactions once Squads time lock is enabled; all executed transactions are announced. Signer identities are disclosed to launchpads and exchanges on request, not published. Reviewers can rely on both identities and the on-chain controls (multisig threshold, time lock, immutable program, locked LP, published vesting streams).

---

## 3. Program security model

Source: `programs/xailens-lock/src/lib.rs`. One pool PDA, one vault PDA, one `LockAccount` PDA per wallet.

Invariants an auditor should confirm:

1. Tokens can only leave the vault through `withdraw` to the lock owner's own token account. There is no admin withdrawal path.
2. `withdraw` is never gated by `paused`. Pause only blocks `lock`.
3. The cooldown of a pending unlock is snapshotted in the `LockAccount`; `update_pool` cannot extend it. The cooldown itself is capped at 30 days.
4. `initialize` requires the signer to be the program's upgrade authority (ProgramData check) and can run only once (fixed seed). No front-running.
5. Authority transfer is two-step; the pending authority must sign to accept.
6. Threshold clocks (`discount_since`, `founder_since`, `voting_since`) start when a threshold is first met, never move backwards on top-ups, and reset on `request_unlock` and `withdraw`.
7. All arithmetic is checked; the pool's `total_locked` equals the sum of all `LockAccount.amount`.
8. The program emits no tokens and holds no reward vault.

Known accepted limitations: a wallet can only have one lock position; partial withdrawal is not supported (unlock is all-or-nothing); the program does not enforce the 25-day or 6-month periods itself, the SDK and server do, so the off-chain reader is part of the trust model.

---

## 4. Review model: no paid audit at launch

Decision (2026-10-28): the project will not commission a paid third-party audit before launch. Security assurance instead rests on:

1. A deliberately small program: eight instructions, no reward arithmetic, no admin withdrawal path, no pausable withdrawals.
2. Open source with a pinned, reproducible build (`Cargo.lock`, `package-lock.json`, Anchor 0.31.1); the deployed `.so` hash must match a `solana-verify` build so anyone can confirm the code on-chain is the code in this repository.
3. The integration test suite in `tests/` (28 cases) covering every instruction, every error path, pause semantics, cooldown snapshot and authority transfer; the SDK unit tests covering the entitlement rules.
4. A public review window before mainnet: the program runs on devnet for 30 days (2026-10-28 to 2026-11-27) with a published invitation to review; findings are tracked as GitHub issues and fixed before mainnet.
5. Immutable upgrade authority after a 14-day mainnet bake period with no open findings.
6. A community bug bounty funded from the ecosystem bucket once the token is live (amounts TODO, TOKENOMICS D1).

If a launchpad or exchange requires an audit report, the scope below is ready to hand to an auditor at that time, funded from the raise.

### Audit scope (for whenever an audit is commissioned)

In scope:

- `programs/xailens-lock/src/lib.rs` (all instructions, account constraints, PDA seeds, CPI to the token program, event correctness).
- `sdk/src/eligibility.ts` and `sdk/src/lock.ts` (entitlement logic that the platform relies on).
- `scripts/setup-metadata.ts`, `scripts/revoke-authority.ts`, `scripts/distribute.ts` (the TGE runbook).
- `tests/` as evidence of intended behaviour.
- Build reproducibility: `Cargo.lock`, `package-lock.json`, Anchor 0.31.1, platform-tools version used for the release build (recorded in the release notes); the deployed `.so` hash must match a `solana-verify` build.
- `scripts/create-mint-legacy.ts` (launch path), `scripts/init-lock-pool.ts`, `scripts/create-vesting-streams.ts`, and later the Token-2022 migration swap program (TOKENOMICS section 1.1).

Out of scope: Token-2022 itself, Squads, Streamflow, Raydium, the xAILens web platform (separate review).

Deliverables requested: findings with severity, PoC for anything High or above, a re-audit of fixes, a public report that can be linked from README.md.

---

## 5. Operational security

- Deployer key on a hardware wallet, used for the TGE runbook only, then emptied.
- No personal data of team members or subscribers is stored in on-chain metadata or program accounts.
- No private keys, RPC URLs with API keys, or `.env` files in the repository (`.gitignore` covers `*keypair*.json`, `.env*`, `id.json`).
- Scripts default to devnet, redact RPC URLs in output, and require an interactive "yes" on mainnet.
- Server-side balance verification: the platform reads lock accounts via its own RPC. Frontend-supplied balances or signatures are never used for entitlements.
- **Trading signals are never published on the XAILENS token, in token metadata, in program events, or in any on-chain data.** Signals stay inside the subscription product. The token repository, SDK and docs contain no signal, strategy or trade data.

---

## 6. Incident response

- Pause `lock` via the multisig if a vulnerability is found in the lock program. Withdrawals keep working by design.
- If the vault could be at risk, announce, keep withdrawals open, and never upgrade without a second review.
- Post-mortem published within 14 days.

---

## 7. Reporting a vulnerability

Email security@xailens.com. Do not open a public issue. Acknowledgement within 48 hours, assessment within 7 days, fix for Critical issues as soon as possible, disclosure after the fix. A bug bounty is planned after the external audit; until then valid reports are credited and may be rewarded at the team's discretion.
