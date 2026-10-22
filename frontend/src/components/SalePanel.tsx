import { useState } from "react";
import type { WalletClient } from "viem";
import { TokenSaleAbi } from "../abi";
import { SaleState, type AssetInfo, type SaleInfo } from "../lib/platform";
import {
  ensureUsdcAllowance,
  fmtTokens,
  fmtUsdc,
  parseTokens,
  write,
} from "../lib/tx";
import type { Run } from "./types";

const STATE_LABEL: Record<SaleState, string> = {
  [SaleState.Active]: "Active",
  [SaleState.Succeeded]: "Succeeded",
  [SaleState.Failed]: "Failed",
};

function quote(sale: SaleInfo, amount: bigint) {
  // Mirrors TokenSale.quote: rounds up
  const scaled = amount * sale.pricePerToken;
  return (scaled + 10n ** 18n - 1n) / 10n ** 18n;
}

function timing(sale: SaleInfo) {
  const now = Date.now() / 1000;
  const days = (s: number) => Math.max(0, Math.ceil(s / 86_400));
  if (sale.state !== SaleState.Active) return null;
  if (now < sale.startTime) return `Opens in ${days(sale.startTime - now)} days`;
  if (now < sale.endTime) return `Closes in ${days(sale.endTime - now)} days`;
  return "Sale window closed";
}

export default function SalePanel({
  asset,
  sale,
  wallet,
  run,
  busy,
}: {
  asset: AssetInfo;
  sale: SaleInfo;
  wallet: WalletClient;
  run: Run;
  busy: boolean;
}) {
  const [amount, setAmount] = useState("");
  let parsed = 0n;
  try {
    parsed = parseTokens(amount);
  } catch {
    parsed = 0n;
  }
  const cost = quote(sale, parsed);

  const soldPct = Number((sale.tokensSold * 10_000n) / sale.hardCap) / 100;
  const softPct = Number((sale.softCap * 10_000n) / sale.hardCap) / 100;
  const ended =
    Date.now() / 1000 >= sale.endTime || sale.tokensSold >= sale.hardCap;
  const contract = { address: sale.address, abi: TokenSaleAbi } as const;

  const buy = () =>
    run(`Buying ${amount} ${asset.symbol}`, async () => {
      await ensureUsdcAllowance(wallet, sale.address, cost);
      await write(wallet, { ...contract, functionName: "buy", args: [parsed] });
      setAmount("");
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h4>Primary sale</h4>
        <span className={`pill sale-${STATE_LABEL[sale.state].toLowerCase()}`}>
          {STATE_LABEL[sale.state]}
        </span>
      </div>

      <dl className="facts">
        <div>
          <dt>Price</dt>
          <dd>{fmtUsdc(sale.pricePerToken)} USDC</dd>
        </div>
        <div>
          <dt>Sold</dt>
          <dd>
            {fmtTokens(sale.tokensSold)} / {fmtTokens(sale.hardCap)}
          </dd>
        </div>
        <div>
          <dt>Soft cap</dt>
          <dd>{fmtTokens(sale.softCap)}</dd>
        </div>
        <div>
          <dt>Minimum</dt>
          <dd>{fmtTokens(sale.minPurchase)}</dd>
        </div>
      </dl>

      <div
        className="progress"
        role="progressbar"
        aria-valuenow={soldPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tokens sold"
      >
        <div className="progress-fill" style={{ width: `${soldPct}%` }} />
        <div
          className="progress-mark"
          style={{ left: `${softPct}%` }}
          title="Soft cap"
        />
      </div>
      {timing(sale) && <p className="muted small">{timing(sale)}</p>}

      {sale.isOpen && (
        <div className="row">
          <input
            inputMode="decimal"
            placeholder={`Amount of ${asset.symbol}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Amount of ${asset.symbol} to buy`}
          />
          <button
            className="primary"
            disabled={busy || parsed === 0n || !asset.amWhitelisted}
            onClick={buy}
          >
            {parsed > 0n ? `Buy for ${fmtUsdc(cost)} USDC` : "Buy"}
          </button>
        </div>
      )}
      {sale.isOpen && !asset.amWhitelisted && (
        <p className="muted small">
          Your wallet must be verified by the issuer before you can buy.
        </p>
      )}

      {sale.myTokensPurchased > 0n && (
        <p className="small">
          You bought <strong>{fmtTokens(sale.myTokensPurchased)}</strong>{" "}
          {asset.symbol} for {fmtUsdc(sale.myAmountPaid)} USDC
          {sale.state === SaleState.Active && " — held in escrow until the sale closes"}
        </p>
      )}

      <div className="row wrap">
        {sale.state === SaleState.Active && ended && (
          <button
            disabled={busy}
            onClick={() =>
              run("Finalizing sale", () =>
                write(wallet, { ...contract, functionName: "finalize", args: [] }),
              )
            }
          >
            Finalize sale
          </button>
        )}
        {sale.state === SaleState.Succeeded && sale.myTokensPurchased > 0n && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(`Claiming ${asset.symbol}`, () =>
                write(wallet, { ...contract, functionName: "claimTokens", args: [] }),
              )
            }
          >
            Claim tokens
          </button>
        )}
        {sale.state === SaleState.Failed && sale.myAmountPaid > 0n && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run("Requesting refund", () =>
                write(wallet, { ...contract, functionName: "refund", args: [] }),
              )
            }
          >
            Refund {fmtUsdc(sale.myAmountPaid)} USDC
          </button>
        )}
        {sale.iAmIssuer && sale.state === SaleState.Active && (
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              run("Cancelling sale", () =>
                write(wallet, { ...contract, functionName: "cancel", args: [] }),
              )
            }
          >
            Cancel sale
          </button>
        )}
      </div>
    </section>
  );
}
