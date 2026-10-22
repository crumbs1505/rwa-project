import { useCallback, useEffect, useState } from "react";
import type { Address, WalletClient } from "viem";
import AssetCard, { valueOf } from "./components/AssetCard";
import LaunchForm from "./components/LaunchForm";
import type { Run } from "./components/types";
import { chain, connectWallet, publicClient } from "./lib/chain";
import { loadPlatform, type PlatformState } from "./lib/platform";
import { errorMessage, fmtUsdc, shortAddress } from "./lib/tx";

type Status = { kind: "pending" | "success" | "error"; text: string } | null;

export default function App() {
  const [account, setAccount] = useState<Address>();
  const [wallet, setWallet] = useState<WalletClient>();
  const [platform, setPlatform] = useState<PlatformState>();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      setPlatform(await loadPlatform(account));
    } catch (e) {
      setStatus({ kind: "error", text: `Could not load data: ${errorMessage(e)}` });
    }
  }, [account]);

  // Reload on every new block so balances and yields stay current
  useEffect(() => {
    if (!account) return;
    refresh();
    return publicClient.watchBlockNumber({
      onBlockNumber: () => refresh(),
      pollingInterval: 2_000,
    });
  }, [account, refresh]);

  // Follow account switches in the wallet
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider || !account) return;
    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(undefined);
        setWallet(undefined);
        setPlatform(undefined);
      } else {
        connect();
      }
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener("accountsChanged", onAccounts);
  });

  const connect = async () => {
    try {
      const connected = await connectWallet();
      setPlatform(undefined);
      setAccount(connected.account);
      setWallet(connected.wallet);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) });
    }
  };

  const run: Run = async (label, action) => {
    setBusy(true);
    setStatus({ kind: "pending", text: `${label}…` });
    try {
      await action();
      setStatus({ kind: "success", text: `${label} — done` });
    } catch (e) {
      setStatus({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const totals = platform?.assets.reduce(
    (acc, a) => ({
      value: acc.value + valueOf(a, a.myBalance),
      claimable: acc.claimable + a.myPendingYield,
    }),
    { value: 0n, claimable: 0n },
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▦
          </span>
          RWA Portal
        </div>
        <div className="topbar-right">
          <span className="pill">{chain.name}</span>
          {account ? (
            <span className="pill mono" title={account}>
              {shortAddress(account)}
            </span>
          ) : (
            <button className="primary" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {status && (
        <div className={`status ${status.kind}`} role="status">
          {status.text}
          {status.kind !== "pending" && (
            <button className="link" onClick={() => setStatus(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      {!account && (
        <section className="hero">
          <h1>Own a share of real property</h1>
          <p>
            Each property is a compliant token on-chain. Verified investors buy
            shares in escrowed sales and collect their share of the rent in
            USDC whenever the issuer distributes it.
          </p>
          <button className="primary large" onClick={connect}>
            Connect wallet
          </button>
        </section>
      )}

      {account && !platform && <p className="muted center">Loading platform…</p>}

      {account && wallet && platform && totals && (
        <main>
          <section className="summary">
            <div>
              <span>Portfolio value</span>
              <strong>${fmtUsdc(totals.value)}</strong>
            </div>
            <div>
              <span>Claimable rent</span>
              <strong className="accent">${fmtUsdc(totals.claimable)}</strong>
            </div>
            <div>
              <span>USDC balance</span>
              <strong>${fmtUsdc(platform.myUsdc)}</strong>
            </div>
            <div>
              <span>Properties</span>
              <strong>{platform.assets.length}</strong>
            </div>
          </section>

          <div className="cards">
            {platform.assets.map((asset) => (
              <AssetCard
                key={asset.token}
                asset={asset}
                wallet={wallet}
                run={run}
                busy={busy}
                canManageRegistry={platform.canManageRegistry}
              />
            ))}
          </div>

          {platform.canLaunch && (
            <LaunchForm account={account} wallet={wallet} run={run} busy={busy} />
          )}
        </main>
      )}
    </div>
  );
}
