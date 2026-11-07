import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCK_PROGRAM_ID } from "./constants.js";
import rawIdl from "./idl/xailens_lock.json";

test("F5: LOCK_PROGRAM_ID matches the program id in the IDL (declare_id!)", () => {
  assert.equal(LOCK_PROGRAM_ID.toBase58(), rawIdl.address);
});

// ----------------------------------------------------------------------------- F6

import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LEGACY_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import { LockClient } from "./lock.js";

/** Minimal in-memory Connection: only getAccountInfo is used by the paths under test. */
function fakeConnection(accounts: Map<string, AccountInfo<Buffer>>): Connection {
  return {
    rpcEndpoint: "http://fake",
    commitment: "confirmed",
    getAccountInfo: async (pk: PublicKey) => accounts.get(pk.toBase58()) ?? null,
    getAccountInfoAndContext: async (pk: PublicKey) => ({ context: { slot: 1 }, value: accounts.get(pk.toBase58()) ?? null }),
  } as unknown as Connection;
}

async function clientWithMintOwner(mintOwner: PublicKey, tokenProgramId?: PublicKey) {
  const mint = Keypair.generate().publicKey;
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const client = new LockClient(fakeConnection(accounts), { mint, tokenProgramId });
  const poolData = await client.program.coder.accounts.encode("lockPool", {
    authority: PublicKey.default,
    pendingAuthority: PublicKey.default,
    mint,
    vault: Keypair.generate().publicKey,
    cooldownPeriod: new BN(7 * 86400),
    discountThreshold: new BN(0),
    founderThreshold: new BN(0),
    votingThreshold: new BN(0),
    totalLocked: new BN(0),
    paused: false,
    bump: 255,
  });
  accounts.set(client.poolAddress.toBase58(), { data: poolData, owner: client.programId, lamports: 1, executable: false });
  accounts.set(mint.toBase58(), { data: Buffer.alloc(82), owner: mintOwner, lamports: 1, executable: false });
  return { client, mint };
}

test("F6: builders use the token program that owns the mint, not the env default", async () => {
  delete process.env.XAILENS_TOKEN_PROGRAM; // env says legacy
  const { client, mint } = await clientWithMintOwner(TOKEN_2022_PROGRAM_ID);
  const user = Keypair.generate().publicKey;
  for (const ix of [await client.buildLockIx(user, "1000"), await client.buildWithdrawIx(user)]) {
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    assert.ok(keys.includes(TOKEN_2022_PROGRAM_ID.toBase58()), "Token-2022 program passed");
    assert.ok(!keys.includes(LEGACY_TOKEN_PROGRAM_ID.toBase58()), "legacy program not passed");
    assert.ok(keys.includes(getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID).toBase58()), "Token-2022 ATA");
  }
});

test("F6: a mint owned by an unknown program is refused", async () => {
  const { client } = await clientWithMintOwner(Keypair.generate().publicKey);
  await assert.rejects(client.buildLockIx(Keypair.generate().publicKey, "1"), /token program/i);
});

test("F6: an explicit tokenProgramId that disagrees with the mint owner is refused", async () => {
  const { client } = await clientWithMintOwner(LEGACY_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID);
  await assert.rejects(client.buildLockIx(Keypair.generate().publicKey, "1"), /token program/i);
});
