/**
 * Pure preflight checks shared by the TGE scripts. No network access here, so
 * the rules are unit-tested in tests/preflight.test.ts.
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export type Cluster = "mainnet-beta" | "devnet" | "localnet" | "custom";

export const XAILENS_DECIMALS = 6;

/**
 * Best-effort cluster detection from the RPC URL. Anything that is not
 * clearly devnet or localhost is "custom" and must be treated like mainnet
 * (a paid mainnet RPC URL often does not contain the word "mainnet").
 */
export function clusterFromRpcUrl(url: string): Cluster {
  const u = url.toLowerCase();
  if (u.includes("mainnet")) return "mainnet-beta";
  if (u.includes("devnet")) return "devnet";
  try {
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0") return "localnet";
  } catch {
    // fall through
  }
  return "custom";
}

const CLUSTERS: readonly Cluster[] = ["mainnet-beta", "devnet", "localnet", "custom"];

/**
 * Cluster for a script run: `SOLANA_CLUSTER` (when set) wins over URL
 * detection, so a paid mainnet RPC without "mainnet" in its URL can be
 * declared explicitly. Invalid values are an error, never a silent default.
 */
export function resolveCluster(rpcUrl: string, override: string | undefined = process.env.SOLANA_CLUSTER): Cluster {
  if (override) {
    if (!(CLUSTERS as readonly string[]).includes(override)) {
      throw new Error(`SOLANA_CLUSTER must be one of ${CLUSTERS.join(", ")} (got "${override}")`);
    }
    return override as Cluster;
  }
  return clusterFromRpcUrl(rpcUrl);
}

/** For scripts that pick cluster-specific addresses (USDC mint, Streamflow program). */
export function requireKnownCluster(cluster: Cluster): Exclude<Cluster, "custom"> {
  if (cluster === "custom") {
    throw new Error("cannot tell the cluster from SOLANA_RPC_URL; set SOLANA_CLUSTER=mainnet-beta or SOLANA_CLUSTER=devnet");
  }
  return cluster;
}

/** True when a script must ask for an interactive "yes" before sending transactions. */
export function needsConfirmation(cluster: Cluster): boolean {
  return cluster === "mainnet-beta" || cluster === "custom";
}

/** Hide API keys and tokens that providers put in the path or query string. */
export function sanitizeRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname !== "/" || u.search !== "" ? `${u.protocol}//${u.host}/<redacted>` : url;
  } catch {
    return "<invalid-url>";
  }
}

/** Token program that owns the mint account. Refuses anything but legacy SPL and Token-2022. */
export function tokenProgramFromOwner(owner: PublicKey): PublicKey {
  if (owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`mint is owned by ${owner.toBase58()}, which is not a supported token program`);
}

export interface MintFacts {
  decimals: number;
  freezeAuthority: PublicKey | null;
  mintAuthority: PublicKey | null;
}

export interface PreflightResult {
  errors: string[];
  warnings: string[];
}

/**
 * Checks before `initialize` of a lock pool. TGE order: create mint
 * (freeze = null) -> mint 500M -> distribute -> revoke mint authority ->
 * init lock pool. On mainnet (or an unknown cluster) the pool is only created
 * once the supply is final.
 */
export function checkMintForPool(mint: MintFacts, cluster: Cluster): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (mint.decimals !== XAILENS_DECIMALS) {
    errors.push(`mint has ${mint.decimals} decimals, XAILENS uses ${XAILENS_DECIMALS}`);
  }
  if (mint.freezeAuthority) {
    errors.push(`freeze authority ${mint.freezeAuthority.toBase58()} is set; XAILENS must never have one (the program rejects it too)`);
  }
  if (mint.mintAuthority) {
    const msg = `mint authority ${mint.mintAuthority.toBase58()} is still set; run scripts/revoke-authority.ts --mint first`;
    if (needsConfirmation(cluster)) errors.push(msg);
    else warnings.push(msg);
  }
  return { errors, warnings };
}
