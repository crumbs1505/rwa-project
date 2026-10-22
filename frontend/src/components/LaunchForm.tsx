import { useState, type FormEvent } from "react";
import { isAddress, keccak256, toHex, type Address, type WalletClient } from "viem";
import { AssetFactoryAbi } from "../abi";
import { addresses } from "../lib/chain";
import { parseUsdc, write } from "../lib/tx";
import type { Run } from "./types";

// Launches a new property through AssetFactory.createAsset
export default function LaunchForm({
  account,
  wallet,
  run,
  busy,
}: {
  account: Address;
  wallet: WalletClient;
  run: Run;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [valuation, setValuation] = useState("");
  const [document, setDocument] = useState("");
  const [owner, setOwner] = useState<string>(account);

  const ready =
    name.trim() && symbol.trim() && valuation.trim() && isAddress(owner);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    run(`Launching ${name}`, async () => {
      await write(wallet, {
        address: addresses.factory,
        abi: AssetFactoryAbi,
        functionName: "createAsset",
        args: [
          {
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            valuation: parseUsdc(valuation),
            // Only the hash of the legal document goes on-chain
            legalDocHash: keccak256(toHex(document.trim())),
            owner: owner as Address,
          },
        ],
      });
      setName("");
      setSymbol("");
      setValuation("");
      setDocument("");
    });
  };

  return (
    <form className="card launch" onSubmit={submit}>
      <header className="card-head">
        <div>
          <h3>Launch a property</h3>
          <p className="muted small">
            Deploys its token and rent distributor, registers it and hands
            every role to the owner in one transaction.
          </p>
        </div>
      </header>
      <div className="grid-2">
        <label className="field">
          <span>Property name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Token symbol</span>
          <input
            value={symbol}
            maxLength={8}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Valuation (USDC)</span>
          <input
            inputMode="decimal"
            value={valuation}
            onChange={(e) => setValuation(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Owner wallet</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value.trim())} />
        </label>
      </div>
      <label className="field">
        <span>Legal document reference (hashed on-chain)</span>
        <input
          placeholder="e.g. ipfs://… or title deed number"
          value={document}
          onChange={(e) => setDocument(e.target.value)}
        />
      </label>
      <button className="primary" type="submit" disabled={busy || !ready}>
        Launch property
      </button>
    </form>
  );
}
