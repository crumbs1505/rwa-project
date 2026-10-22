import { useState } from "react";
import { isAddress, type Address, type WalletClient } from "viem";
import { AssetRegistryAbi, RWATokenAbi, YieldDistributorAbi } from "../abi";
import { addresses } from "../lib/chain";
import type { AssetInfo } from "../lib/platform";
import {
  ensureUsdcAllowance,
  parseTokens,
  parseUsdc,
  write,
} from "../lib/tx";
import type { Run } from "./types";

// Operator actions for the asset's issuer / compliance officer
export default function IssuerTools({
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
  const [investor, setInvestor] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [rent, setRent] = useState("");
  const [valuation, setValuation] = useState("");

  const token = { address: asset.token, abi: RWATokenAbi } as const;
  const validInvestor = isAddress(investor);
  const who = investor as Address;

  return (
    <section className="panel issuer">
      <div className="panel-head">
        <h4>Issuer tools</h4>
        <span className="pill">
          {[asset.iAmIssuer && "Issuer", asset.iAmCompliance && "Compliance"]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <label className="field">
        <span>Investor wallet</span>
        <input
          placeholder="0x…"
          value={investor}
          onChange={(e) => setInvestor(e.target.value.trim())}
        />
      </label>

      {asset.iAmCompliance && (
        <div className="row wrap">
          {(
            [
              ["Verify", "setWhitelist", true],
              ["Revoke", "setWhitelist", false],
              ["Freeze", "setFrozen", true],
              ["Unfreeze", "setFrozen", false],
            ] as const
          ).map(([label, fn, status]) => (
            <button
              key={label}
              disabled={busy || !validInvestor}
              onClick={() =>
                run(`${label} ${who}`, () =>
                  write(wallet, { ...token, functionName: fn, args: [who, status] }),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {asset.iAmIssuer && (
        <>
          <div className="row">
            <input
              inputMode="decimal"
              placeholder={`Mint ${asset.symbol} to investor`}
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              aria-label="Amount to mint"
            />
            <button
              disabled={busy || !validInvestor || !mintAmount}
              onClick={() =>
                run(`Minting ${mintAmount} ${asset.symbol}`, async () => {
                  await write(wallet, {
                    ...token,
                    functionName: "mint",
                    args: [who, parseTokens(mintAmount)],
                  });
                  setMintAmount("");
                })
              }
            >
              Mint
            </button>
          </div>

          <div className="row">
            <input
              inputMode="decimal"
              placeholder="Rental income (USDC)"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              aria-label="Rental income to distribute"
            />
            <button
              disabled={busy || !rent}
              onClick={() =>
                run(`Distributing ${rent} USDC`, async () => {
                  const amount = parseUsdc(rent);
                  await ensureUsdcAllowance(wallet, asset.distributor, amount);
                  await write(wallet, {
                    address: asset.distributor,
                    abi: YieldDistributorAbi,
                    functionName: "depositRentalIncome",
                    args: [amount],
                  });
                  setRent("");
                })
              }
            >
              Distribute rent
            </button>
          </div>

        </>
      )}

      {canManageRegistry && (
        <>
          <div className="row">
            <input
              inputMode="decimal"
              placeholder="New valuation (USDC)"
              value={valuation}
              onChange={(e) => setValuation(e.target.value)}
              aria-label="New valuation"
            />
            <button
              disabled={busy || !valuation}
              onClick={() =>
                run("Updating valuation", async () => {
                  await write(wallet, {
                    address: addresses.registry,
                    abi: AssetRegistryAbi,
                    functionName: "updateValuation",
                    args: [asset.id, parseUsdc(valuation)],
                  });
                  setValuation("");
                })
              }
            >
              Update valuation
            </button>
          </div>
        </>
      )}
    </section>
  );
}
