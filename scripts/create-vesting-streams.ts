/**
 * Create Streamflow vesting streams and the LP lock at TGE.
 *
 * Streams are created BY THE SENDER (the deployer wallet holding the tokens),
 * which is why vested buckets stay in the deployer wallet after
 * scripts/distribute.ts. Every stream is non-cancellable by anyone and
 * non-transferable by the sender. Schedules come from config/vesting.json.
 *
 * TGE percent is released as the stream's cliff amount at `tgeTimestamp`;
 * the remainder vests per second from the cliff date for `vestDays`.
 *
 * Environment variables:
 *   SOLANA_RPC_URL          - RPC endpoint (default: devnet)
 *   DEPLOYER_KEYPAIR_PATH   - sender keypair (default ~/.config/solana/id.json)
 *   XAILENS_MINT            - mint address
 *   XAILENS_TOKEN_PROGRAM   - "token2022" or "legacy" (default legacy)
 *   VESTING_CONFIG          - path to the config (default private/config/vesting.json, gitignored; see config/vesting.example.json)
 *
 * Usage:
 *   npx tsx scripts/create-vesting-streams.ts --dry-run        # print schedule only
 *   npx tsx scripts/create-vesting-streams.ts                  # create vesting streams
 *   npx tsx scripts/create-vesting-streams.ts --lp-lock        # create the LP lock only
 */
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SolanaStreamClient, ICluster, getBN, buildVestingParams, buildLockParams } from "@streamflow/stream";
import BN from "bn.js";

// @streamflow/stream bundles its own copy of @solana/web3.js, so its Keypair
// type differs from ours only nominally (identical runtime shape). The casts
// below are the documented workaround.
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const DECIMALS = 6;
const DAY = 24 * 3600;

interface Recipient { name: string; address: string; tokens: number }
interface Bucket { label: string; tgePercent: number; cliffDays: number; vestDays: number; recipients: Recipient[] }
interface VestingConfig {
  tgeTimestamp: number | string;
  buckets: Bucket[];
  lpLock: { lpMint: string; recipient: string; lpAmountRaw: string; lockDays: number };
}

function loadKeypair(p: string): Keypair {
  const resolved = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}
function isPlaceholder(v: unknown): boolean {
  return typeof v !== "string" || v.startsWith("TODO") || v.length < 32;
}
function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const lpOnly = process.argv.includes("--lp-lock");
  const cfgPath = process.env.VESTING_CONFIG || path.resolve(__dirname, "..", "private", "config", "vesting.json");
  const cfg: VestingConfig = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  const tge = Number(cfg.tgeTimestamp);
  if (!Number.isFinite(tge) || tge < 1_700_000_000) throw new Error("config/vesting.json: tgeTimestamp must be a unix timestamp in seconds");

  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const isMainnet = rpcUrl.includes("mainnet");
  const sender = loadKeypair(process.env.DEPLOYER_KEYPAIR_PATH || "~/.config/solana/id.json");
  const tokenProgramId = process.env.XAILENS_TOKEN_PROGRAM === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const client = new SolanaStreamClient(rpcUrl, isMainnet ? ICluster.Mainnet : ICluster.Devnet, "confirmed");

  console.log(`Sender : ${sender.publicKey.toBase58()}`);
  console.log(`Cluster: ${isMainnet ? "mainnet-beta" : "devnet/custom"}  TGE: ${new Date(tge * 1000).toISOString()}`);

  if (lpOnly) {
    const { lpMint, recipient, lpAmountRaw, lockDays } = cfg.lpLock;
    if ([lpMint, recipient, lpAmountRaw].some(isPlaceholder)) throw new Error("config/vesting.json lpLock has TODO values");
    const params = buildLockParams({
      recipient,
      tokenId: lpMint,
      amount: new BN(lpAmountRaw),
      unlockDate: tge + lockDays * DAY,
      name: "XAILENS LP lock 12m",
      transferableByRecipient: false,
      tokenProgramId: TOKEN_PROGRAM_ID, // Raydium CPMM LP mints are legacy SPL
    });
    console.log(`LP lock: ${lpAmountRaw} raw LP of ${lpMint} -> ${recipient}, unlock ${new Date((tge + lockDays * DAY) * 1000).toISOString()}`);
    if (dryRun) return;
    if (isMainnet && (await prompt('MAINNET. Type "yes" to create the LP lock: ')) !== "yes") return;
    const res = await client.create(params, { sender: sender as never });
    console.log(`LP lock stream: ${res.metadataId}  tx ${res.txId}`);
    return;
  }

  const mintStr = process.env.XAILENS_MINT;
  if (!mintStr) throw new Error("Set XAILENS_MINT");
  const mint = new PublicKey(mintStr);

  const plan: Array<{ bucket: string; r: Recipient; cliffAmount: BN; total: BN; cliffAt: number; endAt: number }> = [];
  for (const b of cfg.buckets) {
    for (const r of b.recipients) {
      if (isPlaceholder(r.address)) {
        console.error(`FATAL: ${b.label} / ${r.name} has a placeholder address`);
        process.exit(1);
      }
      const total = getBN(r.tokens, DECIMALS);
      const cliffAmount = total.muln(b.tgePercent).divn(100);
      plan.push({ bucket: b.label, r, cliffAmount, total, cliffAt: tge + b.cliffDays * DAY, endAt: tge + (b.cliffDays + b.vestDays) * DAY });
    }
  }
  console.log();
  for (const p of plan) {
    console.log(`${p.bucket.padEnd(14)} ${p.r.name.padEnd(18)} ${p.r.tokens.toLocaleString().padStart(14)} tokens  at TGE ${p.cliffAmount.div(new BN(10 ** DECIMALS)).toString().padStart(12)}  cliff ${new Date(p.cliffAt * 1000).toISOString().slice(0, 10)}  end ${new Date(p.endAt * 1000).toISOString().slice(0, 10)}`);
  }
  if (dryRun) { console.log("\nDry run, nothing created."); return; }
  if (isMainnet && (await prompt('\nMAINNET. Type "yes" to create all streams: ')) !== "yes") return;

  const out: Array<{ bucket: string; name: string; recipient: string; stream: string; tx: string }> = [];
  for (const p of plan) {
    const params = buildVestingParams({
      recipient: p.r.address,
      tokenId: mint.toBase58(),
      amount: p.total,
      start: p.cliffAt,            // nothing unlocks before the cliff date (TGE for 0-day cliffs)
      duration: p.endAt - p.cliffAt,
      period: 1,                   // per-second unlock after the cliff
      cliffAmount: p.cliffAmount,  // TGE percent released at `start`
      name: `XAILENS ${p.bucket} ${p.r.name}`.slice(0, 64),
      cancelableBySender: false,
      canTopup: false,
      transferableBySender: false,
      transferableByRecipient: false,
      automaticWithdrawal: false,
      tokenProgramId,
    });
    const res = await client.create(params, { sender: sender as never });
    console.log(`created ${p.bucket}/${p.r.name}: stream ${res.metadataId} tx ${res.txId}`);
    out.push({ bucket: p.bucket, name: p.r.name, recipient: p.r.address, stream: res.metadataId, tx: res.txId });
  }
  const outPath = path.resolve(__dirname, "..", isMainnet ? "private/config" : "config", `streams-${isMainnet ? "mainnet" : "devnet"}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${outPath}. Publish the stream addresses in README.md.`);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
