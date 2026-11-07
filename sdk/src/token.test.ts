import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { AccountLayout, MintLayout, ACCOUNT_SIZE, MINT_SIZE, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { LEGACY_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import { createXailensTransferInstruction, getXailensBalance, getXailensMintInfo } from "./token.js";

/** Minimal in-memory Connection: only the account reads used by spl-token are implemented. */
function fakeConnection(accounts: Map<string, AccountInfo<Buffer>>): Connection {
  const get = (pk: PublicKey) => accounts.get(pk.toBase58()) ?? null;
  return {
    rpcEndpoint: "http://fake",
    commitment: "confirmed",
    getAccountInfo: async (pk: PublicKey) => get(pk),
    getAccountInfoAndContext: async (pk: PublicKey) => ({ context: { slot: 1 }, value: get(pk) }),
  } as unknown as Connection;
}

function mintAccount(owner: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 500_000_000_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner, lamports: 1, executable: false };
}

function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint, program: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner: program, lamports: 1, executable: false };
}

test("F9: read helpers use the token program that owns the mint, not the env default", async () => {
  delete process.env.XAILENS_TOKEN_PROGRAM; // env says legacy
  const mint = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
  const conn = fakeConnection(
    new Map([
      [mint.toBase58(), mintAccount(TOKEN_2022_PROGRAM_ID)],
      [ata.toBase58(), tokenAccount(mint, wallet, 12_500_000n, TOKEN_2022_PROGRAM_ID)],
    ]),
  );
  const info = await getXailensMintInfo(conn, mint);
  assert.equal(info.decimals, 6);
  assert.equal(info.supply, 500_000_000_000_000n);
  assert.equal(await getXailensBalance(conn, wallet, mint), 12.5);
});

test("F9: read helpers refuse a mint owned by an unknown program", async () => {
  const mint = Keypair.generate().publicKey;
  const conn = fakeConnection(new Map([[mint.toBase58(), mintAccount(Keypair.generate().publicKey)]]));
  await assert.rejects(getXailensMintInfo(conn, mint), /token program/i);
  await assert.rejects(getXailensBalance(conn, Keypair.generate().publicKey, mint), /token program/i);
});

test("F9: the transfer builder requires an explicit mint and token program", () => {
  const [a, b, o, m] = [0, 1, 2, 3].map(() => Keypair.generate().publicKey);
  const build = createXailensTransferInstruction as unknown as (...args: unknown[]) => { programId: PublicKey };
  assert.throws(() => build(a, b, o, 1n, m), /token program/i);
  assert.throws(() => build(a, b, o, 1n), /mint/i);
  assert.ok(build(a, b, o, 1n, m, TOKEN_2022_PROGRAM_ID).programId.equals(TOKEN_2022_PROGRAM_ID));
  assert.ok(build(a, b, o, 1n, m, LEGACY_TOKEN_PROGRAM_ID).programId.equals(LEGACY_TOKEN_PROGRAM_ID));
  assert.throws(() => build(a, b, o, 1n, m, Keypair.generate().publicKey), /token program/i);
});
