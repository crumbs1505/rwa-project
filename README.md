# RWA Project — Real World Asset Tokenization

Smart contracts for tokenizing a real-world property and paying its rental
income to token holders. Built with Hardhat 3, OpenZeppelin 5 and ethers v6.

## Contracts

| Contract | Path | Purpose |
| --- | --- | --- |
| `RWARoles` | `contracts/governance/` | Shared roles: `ISSUER_ROLE`, `COMPLIANCE_ROLE`, `PAUSER_ROLE` on top of OpenZeppelin `AccessControl`. |
| `RWAToken` | `contracts/core/` | ERC-20 share of a property. Only whitelisted, non-frozen accounts can hold or move it; the issuer mints and burns; transfers can be paused. |
| `AssetRegistry` | `contracts/core/` | On-chain record of each asset: name, valuation, hash of the legal documents, and its token. |
| `YieldDistributor` | `contracts/finance/` | The issuer deposits rental income (USDC) and holders claim their pro-rata share. |
| `MockUSDC` | `contracts/finance/` | 6-decimal stablecoin for local testing. |

### How yield accounting works

`YieldDistributor` keeps a global `cumulativeYieldPerToken` that grows on each
deposit. Every holder has a snapshot of that value. What they can claim is
`balance × (cumulative − snapshot)` plus anything already settled.

`RWAToken` calls `YieldDistributor.onTokenTransfer` **before** every transfer,
mint and burn, so both parties are settled at their old balances. A buyer only
earns yield from deposits made after they received tokens. Without this hook,
a new holder would start at a snapshot of 0 and could claim yield they never
earned.

## Usage

```shell
npm install
npm test                      # runs the mocha test suite
npx hardhat compile
```

### Deploy

`ignition/modules/RWA.ts` deploys MockUSDC, RWAToken, YieldDistributor and
AssetRegistry. It connects the token to the distributor, gives the deployer
every operational role, and registers the asset.

```shell
# local simulated chain
npm run deploy:local

# Sepolia (set SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY first, e.g. via hardhat-keystore)
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat ignition deploy --network sepolia ignition/modules/RWA.ts
```

Override the asset details with Ignition parameters (`name`, `symbol`,
`valuation`, `legalDocHash`).
