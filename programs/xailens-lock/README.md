# xailens-lock

On-chain Solana program (Anchor 0.31) that lets XAILENS holders lock tokens in a program-owned vault to prove a holding threshold over time. It emits **no rewards**. Off-chain services read the threshold clocks to grant a subscription discount, Founder-level access and feature voting.

## Instructions

| Instruction | Who | What |
| --- | --- | --- |
| `initialize(params)` | program upgrade authority only | Creates the single pool PDA and vault. Cannot be front-run. |
| `lock(amount)` | holder | Transfers tokens into the vault, starts threshold clocks when a threshold is first met. Blocked while paused or while an unlock is pending. |
| `request_unlock()` | holder | Starts the cooldown (snapshotted from the pool) and clears all threshold clocks. |
| `withdraw()` | holder | Returns the full amount after the cooldown. **Never blocked by pause.** |
| `close_lock_account()` | holder | Reclaims rent once the account is empty. |
| `update_pool(update)` | pool authority | Cooldown (max 30 days), thresholds, pause. Pending unlock requests are unaffected. |
| `propose_authority(new)` / `accept_authority()` | pool authority / proposed | Two-step transfer, intended for handing control to a Squads multisig. |

## State

`LockAccount` stores `amount`, `locked_since`, `last_deposit_at`, and three clocks: `discount_since`, `founder_since`, `voting_since` (0 = threshold not met). A service checks, for example, `discount_since != 0 && now - discount_since >= 25 days && unlock_requested_at == 0`.

Thresholds live in `LockPool` and are set at initialize / `update_pool`; the SDK ships the agreed holding periods.

## Build and test

```bash
anchor build
anchor keys sync   # first time only: writes your local program id into lib.rs and Anchor.toml
anchor test
```

Works with Token-2022 and legacy SPL mints (`TokenInterface`).
