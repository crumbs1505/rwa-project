import type { WalletClient } from "viem";
import { YieldDistributorAbi } from "../abi";
import type { AssetInfo } from "../lib/platform";
import { fmtTokens, fmtUsdc, shortAddress, write } from "../lib/tx";
import IssuerTools from "./IssuerTools";
import SalePanel from "./SalePanel";
import type { Run } from "./types";

// USDC value of `tokens` at the asset's latest valuation
export function valueOf(asset: AssetInfo, tokens: bigint) {
  return asset.totalSupply === 0n
    ? 0n
    : (tokens * asset.valuation) / asset.totalSupply;
}

function ComplianceStatus({ asset }: { asset: AssetInfo }) {
  if (asset.amFrozen) return <span className="pill bad">Frozen</span>;
  if (asset.amWhitelisted) return <span className="pill good">Verified</span>;
  return <span className="pill">Not verified</span>;
}

export default function AssetCard({
  asset,
  wallet,
  run,
  busy,
  canManageRegistry,
}: {
  asset: AssetInfo;
  wallet: WalletClient;
  run: Run;
  busy: boolean;
  canManageRegistry: boolean;
}) {
  const perToken =
    asset.totalSupply === 0n
      ? 0n
      : (asset.valuation * 10n ** 18n) / asset.totalSupply;

  return (
    <article className="card">
      <header className="card-head">
        <div>
          <h3>{asset.name}</h3>
          <p className="muted small mono" title={asset.token}>
            {asset.symbol} · {shortAddress(asset.token)}
          </p>
        </div>
        <span className={`pill ${asset.active ? "good" : "bad"}`}>
          {asset.active ? "Active" : "Inactive"}
        </span>
      </header>

      <dl className="facts">
        <div>
          <dt>Valuation</dt>
          <dd>${fmtUsdc(asset.valuation, 0)}</dd>
        </div>
        <div>
          <dt>Tokens issued</dt>
          <dd>{fmtTokens(asset.totalSupply)}</dd>
        </div>
        <div>
          <dt>Value per token</dt>
          <dd>{asset.totalSupply === 0n ? "—" : `$${fmtUsdc(perToken)}`}</dd>
        </div>
        <div>
          <dt>Rent distributed</dt>
          <dd>${fmtUsdc(asset.totalIncome, 0)}</dd>
        </div>
      </dl>

      <section className="panel">
        <div className="panel-head">
          <h4>Your position</h4>
          <ComplianceStatus asset={asset} />
        </div>
        <dl className="facts">
          <div>
            <dt>Balance</dt>
            <dd>
              {fmtTokens(asset.myBalance)} {asset.symbol}
            </dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd>${fmtUsdc(valueOf(asset, asset.myBalance))}</dd>
          </div>
          <div>
            <dt>Claimable rent</dt>
            <dd className="accent">${fmtUsdc(asset.myPendingYield)}</dd>
          </div>
        </dl>
        <button
          className="primary"
          disabled={busy || asset.myPendingYield === 0n}
          onClick={() =>
            run(`Claiming rent from ${asset.symbol}`, () =>
              write(wallet, {
                address: asset.distributor,
                abi: YieldDistributorAbi,
                functionName: "claimMyYield",
                args: [],
              }),
            )
          }
        >
          Claim ${fmtUsdc(asset.myPendingYield)}
        </button>
      </section>

      {asset.sale && (
        <SalePanel
          asset={asset}
          sale={asset.sale}
          wallet={wallet}
          run={run}
          busy={busy}
        />
      )}

      {(asset.iAmIssuer || asset.iAmCompliance) && (
        <IssuerTools
          asset={asset}
          wallet={wallet}
          run={run}
          busy={busy}
          canManageRegistry={canManageRegistry}
        />
      )}
    </article>
  );
}
