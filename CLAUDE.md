# CLAUDE.md

## Git commits

- Commit as the repo owner, never as Claude. Before the first commit in a session run:
  ```shell
  git config user.name "SufyanShaik"
  git config user.email "157708473+crumbs1505@users.noreply.github.com"
  ```
- Do not add `Co-Authored-By`, `Claude-Session`, "Generated with Claude Code" or any other AI attribution to commit messages or PR descriptions.
- Commit in small, focused steps as work progresses (one logical change per commit), not one large commit at the end.
- Use conventional commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

## Project

Real-world asset tokenization on Hardhat 3 (mocha + ethers v6, OpenZeppelin 5, solc 0.8.24).

- `contracts/governance/RWARoles.sol` – shared AccessControl roles
- `contracts/core/RWAToken.sol` – whitelisted/freezable/pausable ERC-20; calls `YieldDistributor.onTokenTransfer` before every balance change; issuer `burn`, `forcedTransfer` and `recoverWallet` skip sender checks (receiver still checked)
- `contracts/core/AssetRegistry.sol` – asset metadata registry; tokens with a registry set can only mint while their asset is active
- `contracts/core/AssetFactory.sol` – deploys + wires token and distributor per property, registers it, hands roles to the owner (grant roles before renouncing admin)
- `contracts/finance/YieldDistributor.sol` – rental income distribution (cumulative yield-per-token accounting)
- `contracts/finance/TokenSale.sol` – escrowed primary sale (soft/hard cap, refunds); needs ISSUER_ROLE on RWAToken to mint on claim
- `contracts/finance/MockUSDC.sol` – 6-decimal test stablecoin
- `test/` – mocha tests; `ignition/modules/RWA.ts` – full-system deployment; `ignition/modules/TokenSale.ts` – sale on top of it; `ignition/modules/Platform.ts` – registry + factory

Commands: `npm test`, `npx hardhat compile`, `npm run deploy:local`.

Any change to token balances must keep the yield hook in place; the regression tests in `test/RWA.ts` cover it.

## Cloud sessions

`binaries.soliditylang.org` may be blocked by the network policy, making `hardhat compile` fail with HHE905/HHE904. Workaround (does not touch the repo):

1. `npm i solc@0.8.24` in a scratch directory.
2. Copy its `soljson.js` to `~/.cache/hardhat-nodejs/compilers-v3/wasm/soljson-v0.8.24+commit.e11b9ed9.js` and to the same name under `linux-amd64/`, plus an empty `<that file>.does.not.work` marker in `linux-amd64/`.
3. Write a `list.json` in both `wasm/` and `linux-amd64/` containing a single build entry for that file (`version` 0.8.24, `longVersion` 0.8.24+commit.e11b9ed9).
