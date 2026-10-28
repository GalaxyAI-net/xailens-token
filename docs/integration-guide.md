# XAILENS integration guide

How the xAILens platform (or any service) reads XAILENS balances and lock state to grant entitlements. Everything here runs **server-side**. The frontend only signs transactions.

## 1. Rules

- Token program is Token-2022. Always pass `TOKEN_2022_PROGRAM_ID` to `@solana/spl-token` helpers and derive ATAs with it; the legacy program id returns "account not found".
- 6 decimals: raw = UI × 1,000,000. Use `toRawAmount` / `toUiAmount`, never floating-point math on raw values.
- Never trust a balance, signature or lock state reported by the client. Read from your own RPC (Helius, QuickNode, Triton, or your own node). Public RPC is for development only.
- Entitlements come from the lock account, not from the wallet balance.

## 2. Install

```bash
npm install @xailens/solana-sdk @solana/web3.js @solana/spl-token @coral-xyz/anchor
```

## 3. Link a wallet to a subscriber

Sign-in-with-Solana: the server issues a nonce, the wallet signs it, the server verifies with `nacl.sign.detached.verify` and stores the mapping `subscriber -> wallet`. One wallet per subscriber; changing it clears any in-progress lock period for that subscriber (the on-chain clock is per wallet, so the server must not carry it over).

## 4. Entitlement check on the billing date

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { LockClient } from "@xailens/solana-sdk";

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const client = new LockClient(connection, undefined, new PublicKey(process.env.LOCK_PROGRAM_ID!));

export async function entitlementsAt(wallet: PublicKey, billingUnixSeconds: number) {
  return client.getEligibility(wallet, billingUnixSeconds);
  // { discount: boolean, founder: boolean, votes: 0..10 }
}
```

`discount` is true when the wallet has kept at least the pool's discount threshold locked for 25 consecutive days before the billing timestamp and has no unlock pending. Apply the discount to the next cycle only; re-check every cycle. `founder` uses the same rule on the Founder threshold. `votes` requires 6 months above the voting threshold.

Cache results per billing cycle; do not poll RPC on every page load.

## 5. XGold loyalty grant for holders

If a holder benefit in XGold is enabled (TOKENOMICS D5), compute it from the same `entitlementsAt` result on the billing date and credit it to the subscriber's XGold balance for the following month. XGold is an internal, non-transferable credit; it is never written on-chain.

## 6. Accepting XAILENS as payment

1. Server builds a `transfer_checked` instruction from the payer's ATA to the treasury ATA for the exact raw amount (`createXailensTransferInstruction`), with a recent blockhash and a memo containing the invoice id.
2. Client signs and sends; returns the signature.
3. Server fetches the transaction with `getParsedTransaction(sig, { commitment: "confirmed" })`, checks: success, destination is the treasury ATA, mint matches, amount matches, memo matches, and the signature has not been used before. Only then marks the invoice paid.

Price quotes in XAILENS, if offered, must be computed from a rate the server controls and cached with a short validity; never let the client submit the rate.

## 7. Lock UI (client side)

Use `buildLockIx`, `buildRequestUnlockIx`, `buildWithdrawIx`, `buildCloseLockAccountIx` with the user's wallet adapter. Show the user: locked amount, the three clocks (`discount_since`, `founder_since`, `voting_since`), the day the 25-day and 6-month rules are satisfied, and the unlock cooldown snapshot after a request. Warn that `request_unlock` clears all clocks.

## 8. Errors

| Code | Meaning | UI |
| --- | --- | --- |
| `BelowMinimumLock` | less than 1 XAILENS | raise amount |
| `PoolPaused` | new locks paused | show notice; withdrawals still work |
| `UnlockAlreadyRequested` | cannot lock or request again while pending | show cooldown end |
| `CooldownNotElapsed` | withdraw too early | show remaining time |
| `NoUnlockRequested` | withdraw without request | prompt to request unlock |
| `StillLocked` | close with balance | withdraw first |
| `Unauthorized` | wrong signer | should not happen from the UI |

## 9. Operational

- Log every entitlement decision with the slot and account data used, for audit.
- Alert when the pool's `paused` flag or `authority` changes.
- Never embed trading signals, strategy data, or subscriber data in any on-chain memo, metadata or program account.
