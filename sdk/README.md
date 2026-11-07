# @xailens/solana-sdk

TypeScript SDK for the XAILENS token (Token-2022) and the `xailens-lock` program.

```bash
npm install @xailens/solana-sdk @solana/web3.js @solana/spl-token @coral-xyz/anchor
```

## Balances and mint info

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { getXailensBalance, getXailensMintInfo, toRawAmount, toUiAmount } from "@xailens/solana-sdk";

const connection = new Connection(RPC_URL, "confirmed");
const balance = await getXailensBalance(connection, wallet, XAILENS_MINT); // UI amount, 0 if no ATA
const info = await getXailensMintInfo(connection, XAILENS_MINT);          // supply, authorities, metadata
// token program is read from the mint owner; for transfers: getTokenProgramForMint(connection, mint)
toRawAmount("1.5");      // 1500000n
toUiAmount(1500000n);    // 1.5
```

## Lock program

```ts
import { LockClient } from "@xailens/solana-sdk";

const client = new LockClient(connection, { mint }); // read-only; one pool per mint, program id from the IDL
const pool = await client.getPool();
const acc = await client.getLockAccount(wallet);            // null if never locked
const { discount, founder, votes } = await client.getEligibility(wallet);

// with a wallet (Anchor Wallet) the builders return instructions to sign and send
const ix = await client.buildLockIx(wallet, "1000");
```

## Eligibility rules (pure functions, unit-tested)

| Function | Rule |
| --- | --- |
| `isDiscountEligible(acc, pool, now)` | current `discountThreshold` > 0 and `amount >= discountThreshold`, `discount_since` set, no unlock pending, held 25 days |
| `isFounderEligible(acc, pool, now)` | same rule on `founderThreshold` / `founder_since` |
| `getVotes(acc, pool, now)` | same rule on `votingThreshold` / `voting_since`, held 180 days; one vote per `votingThreshold` locked; max 10 |

Pass the pool you just fetched from RPC: an admin can change thresholds with `update_pool`, and an old threshold clock alone does not prove the wallet holds the current threshold.

Always run these server-side against RPC data. Never accept balances or lock state from the client.

## Constants

`XAILENS_DECIMALS`, `XAILENS_TOTAL_SUPPLY`, `XAILENS_MINT` (placeholder until TGE), `LOCK_PROGRAM_ID` (read from the bundled IDL), `DISCOUNT_HOLD_SECONDS`, `VOTING_HOLD_SECONDS`, `VOTING_THRESHOLD`, `MAX_VOTES_PER_WALLET`, `SUBSCRIPTION_PRICES_XGOLD`. `DISCOUNT_THRESHOLD` and `FOUNDER_THRESHOLD` are 0 until decided; read the live values from the pool.

## Build and test

```bash
npm run build
npm test
```

License: Apache-2.0.
