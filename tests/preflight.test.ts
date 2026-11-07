/**
 * F7: pure preflight checks used by scripts/init-lock-pool.ts and
 * scripts/lock-demo.ts before they touch a cluster.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { checkMintForPool, clusterFromRpcUrl, needsConfirmation, requireKnownCluster, resolveCluster, sanitizeRpcUrl, tokenProgramFromOwner } from "../scripts/lib/preflight";

const someKey = Keypair.generate().publicKey;
const good = { decimals: 6, freezeAuthority: null, mintAuthority: null };

describe("F7: script preflight", () => {
  it("classifies clusters from the RPC URL", () => {
    expect(clusterFromRpcUrl("https://api.mainnet-beta.solana.com")).to.equal("mainnet-beta");
    expect(clusterFromRpcUrl("https://mainnet.helius-rpc.com/?api-key=x")).to.equal("mainnet-beta");
    expect(clusterFromRpcUrl("https://api.devnet.solana.com")).to.equal("devnet");
    expect(clusterFromRpcUrl("http://127.0.0.1:8899")).to.equal("localnet");
    expect(clusterFromRpcUrl("http://localhost:8899")).to.equal("localnet");
    expect(clusterFromRpcUrl("https://rpc.example.com")).to.equal("custom");
  });

  it("redacts API keys and paths from RPC URLs", () => {
    expect(sanitizeRpcUrl("https://mainnet.helius-rpc.com/?api-key=SECRET")).to.not.include("SECRET");
    expect(sanitizeRpcUrl("https://x.quiknode.pro/SECRET/")).to.not.include("SECRET");
    expect(sanitizeRpcUrl("https://api.devnet.solana.com")).to.equal("https://api.devnet.solana.com");
  });

  it("derives the token program from the mint owner and refuses anything else", () => {
    expect(tokenProgramFromOwner(TOKEN_PROGRAM_ID).equals(TOKEN_PROGRAM_ID)).to.be.true;
    expect(tokenProgramFromOwner(TOKEN_2022_PROGRAM_ID).equals(TOKEN_2022_PROGRAM_ID)).to.be.true;
    expect(() => tokenProgramFromOwner(someKey)).to.throw(/token program/i);
  });

  it("accepts a correct, fully revoked mint everywhere", () => {
    for (const c of ["mainnet-beta", "devnet", "localnet", "custom"] as const) {
      const r = checkMintForPool(good, c);
      expect(r.errors, c).to.deep.equal([]);
      expect(r.warnings, c).to.deep.equal([]);
    }
  });

  it("rejects wrong decimals and any freeze authority on every cluster", () => {
    expect(checkMintForPool({ ...good, decimals: 9 }, "devnet").errors.join()).to.match(/decimals/);
    expect(checkMintForPool({ ...good, freezeAuthority: someKey }, "localnet").errors.join()).to.match(/freeze/i);
  });

  it("requires the mint authority to be revoked before init on mainnet, warns elsewhere", () => {
    const live = { ...good, mintAuthority: someKey as PublicKey };
    expect(checkMintForPool(live, "mainnet-beta").errors.join()).to.match(/mint authority/i);
    expect(checkMintForPool(live, "custom").errors.join()).to.match(/mint authority/i);
    const dev = checkMintForPool(live, "devnet");
    expect(dev.errors).to.deep.equal([]);
    expect(dev.warnings.join()).to.match(/mint authority/i);
  });
});

describe("F10: cluster detection for paid RPC URLs", () => {
  const paid = "https://xyz.solana-mainnet.quiknode.pro/SECRET/".replace("solana-mainnet", "solana-prod");

  it("treats an unrecognised RPC URL as custom and asks for confirmation", () => {
    expect(resolveCluster(paid, undefined)).to.equal("custom");
    expect(needsConfirmation("custom")).to.be.true;
    expect(needsConfirmation("mainnet-beta")).to.be.true;
    expect(needsConfirmation("devnet")).to.be.false;
    expect(needsConfirmation("localnet")).to.be.false;
  });

  it("lets SOLANA_CLUSTER declare the cluster explicitly and rejects unknown values", () => {
    expect(resolveCluster(paid, "mainnet-beta")).to.equal("mainnet-beta");
    expect(resolveCluster(paid, "devnet")).to.equal("devnet");
    expect(resolveCluster("https://api.devnet.solana.com", "")).to.equal("devnet");
    expect(() => resolveCluster(paid, "mainnet")).to.throw(/SOLANA_CLUSTER/);
  });

  it("refuses a custom cluster where the script must pick cluster-specific addresses", () => {
    expect(() => requireKnownCluster("custom")).to.throw(/SOLANA_CLUSTER/);
    expect(requireKnownCluster("mainnet-beta")).to.equal("mainnet-beta");
    expect(requireKnownCluster("devnet")).to.equal("devnet");
  });
});
