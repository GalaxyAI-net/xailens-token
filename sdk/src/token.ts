import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getTokenMetadata,
  createTransferCheckedInstruction,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

import { XAILENS_DECIMALS, XAILENS_MINT, XAILENS_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

/** UI amount (e.g. 100.5) to raw bigint with 6 decimals. Exact for decimal strings. */
export function toRawAmount(uiAmount: number | string): bigint {
  const str = typeof uiAmount === "number" ? uiAmount.toFixed(XAILENS_DECIMALS) : String(uiAmount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid amount: ${uiAmount}`);
  const [whole, frac = ""] = str.split(".");
  const padded = (frac + "0".repeat(XAILENS_DECIMALS)).slice(0, XAILENS_DECIMALS);
  return BigInt(whole + padded);
}

/** Raw bigint to UI number. */
export function toUiAmount(rawAmount: bigint): number {
  const factor = BigInt(10 ** XAILENS_DECIMALS);
  return Number(rawAmount / factor) + Number(rawAmount % factor) / Number(factor);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Wallet balance (UI amount). 0 when the ATA does not exist. */
export async function getXailensBalance(
  connection: Connection,
  walletPubkey: PublicKey,
  mint: PublicKey = XAILENS_MINT,
  tokenProgramId: PublicKey = XAILENS_TOKEN_PROGRAM_ID,
): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, walletPubkey, false, tokenProgramId);
  try {
    const account = await getAccount(connection, ata, "confirmed", tokenProgramId);
    return toUiAmount(account.amount);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return 0;
    throw err;
  }
}

export interface XailensMintInfo {
  supply: bigint;
  decimals: number;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  metadataUpdateAuthority: PublicKey | null;
  name: string | null;
  symbol: string | null;
  uri: string | null;
}

/** Mint, authority and metadata summary. Used by scripts/verify-authorities.ts. */
export async function getXailensMintInfo(
  connection: Connection,
  mint: PublicKey = XAILENS_MINT,
  tokenProgramId: PublicKey = XAILENS_TOKEN_PROGRAM_ID,
): Promise<XailensMintInfo> {
  const m = await getMint(connection, mint, "confirmed", tokenProgramId);
  const md = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
    ? await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null)
    : null; // legacy mints carry Metaplex metadata; read it with @metaplex-foundation/mpl-token-metadata
  const ua = md?.updateAuthority ?? null;
  return {
    supply: m.supply,
    decimals: m.decimals,
    mintAuthority: m.mintAuthority,
    freezeAuthority: m.freezeAuthority,
    metadataUpdateAuthority: ua && !ua.equals(PublicKey.default) ? ua : null,
    name: md?.name ?? null,
    symbol: md?.symbol ?? null,
    uri: md?.uri ?? null,
  };
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/** Token-2022 transfer_checked instruction for XAILENS. */
export function createXailensTransferInstruction(
  from: PublicKey,
  to: PublicKey,
  owner: PublicKey,
  amount: bigint,
  mint: PublicKey = XAILENS_MINT,
  tokenProgramId: PublicKey = XAILENS_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return createTransferCheckedInstruction(from, mint, to, owner, amount, XAILENS_DECIMALS, [], tokenProgramId);
}
