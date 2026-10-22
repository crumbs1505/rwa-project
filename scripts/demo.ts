// Deploys the platform to a running node and seeds it with demo data for the
// web app: two properties, whitelisted investors, rental income and an open
// token sale. Contract addresses are written to frontend/src/deployments.json.
//
//   npx hardhat node
//   npx hardhat run scripts/demo.ts --network localhost
import { writeFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers } = await network.connect();

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);
const TOKENS = (n: number) => ethers.parseUnits(n.toString(), 18);
const DAY = 24 * 60 * 60;

const [admin, alice, bob, carol] = await ethers.getSigners();
console.log(`Admin / issuer:  ${admin.address}`);
console.log(`Investors:       ${alice.address}, ${bob.address}, ${carol.address}`);

// ── Platform ───────────────────────────────────────────────────────────────

const usdc = await ethers.deployContract("MockUSDC", [admin.address]);
const registry = await ethers.deployContract("AssetRegistry", [admin.address]);
const factory = await ethers.deployContract("AssetFactory", [
  admin.address,
  await registry.getAddress(),
  await usdc.getAddress(),
]);

await (
  await registry.grantRole(await registry.ISSUER_ROLE(), await factory.getAddress())
).wait();
await (await registry.grantRole(await registry.ISSUER_ROLE(), admin.address)).wait();
await (await factory.grantRole(await factory.ISSUER_ROLE(), admin.address)).wait();

for (const investor of [admin, alice, bob, carol]) {
  await (await usdc.mint(investor.address, USDC(100_000))).wait();
}

// ── Properties ─────────────────────────────────────────────────────────────

async function launch(name: string, symbol: string, valuation: number) {
  const params = {
    name,
    symbol,
    valuation: USDC(valuation),
    legalDocHash: ethers.keccak256(ethers.toUtf8Bytes(`${symbol}-title-deed.pdf`)),
    owner: admin.address,
  };
  const [, tokenAddress, distributorAddress] =
    await factory.createAsset.staticCall(params);
  await (await factory.createAsset(params)).wait();

  const token = await ethers.getContractAt("RWAToken", tokenAddress);
  const distributor = await ethers.getContractAt(
    "YieldDistributor",
    distributorAddress,
  );
  console.log(`${symbol}: token ${tokenAddress}, distributor ${distributorAddress}`);
  return { token, distributor };
}

async function payRent(
  distributor: Awaited<ReturnType<typeof launch>>["distributor"],
  amount: bigint,
) {
  await (await usdc.approve(await distributor.getAddress(), amount)).wait();
  await (await distributor.depositRentalIncome(amount)).wait();
}

const apartments = await launch("Main Street Apartments", "MSA", 2_500_000);
for (const investor of [alice, bob, carol]) {
  await (await apartments.token.setWhitelist(investor.address, true)).wait();
}
await (await apartments.token.mint(alice.address, TOKENS(600))).wait();
await (await apartments.token.mint(bob.address, TOKENS(400))).wait();
await payRent(apartments.distributor, USDC(5_000));

const offices = await launch("Harbor View Offices", "HVO", 4_000_000);
for (const investor of [alice, carol]) {
  await (await offices.token.setWhitelist(investor.address, true)).wait();
}
await (await offices.token.mint(carol.address, TOKENS(1_000))).wait();
await payRent(offices.distributor, USDC(2_000));

// ── Open sale for the apartments ───────────────────────────────────────────

const latest = await ethers.provider.getBlock("latest");
const now = latest!.timestamp;
const sale = await ethers.deployContract("TokenSale", [
  admin.address,
  await usdc.getAddress(),
  await apartments.token.getAddress(),
  admin.address,
  USDC(50),
  TOKENS(100),
  TOKENS(2_000),
  TOKENS(1),
  now,
  now + 30 * DAY,
]);
await (
  await apartments.token.grantRole(
    await apartments.token.ISSUER_ROLE(),
    await sale.getAddress(),
  )
).wait();
await (await sale.grantRole(await sale.ISSUER_ROLE(), admin.address)).wait();
console.log(`MSA sale: ${await sale.getAddress()}`);

// ── Hand addresses to the frontend ─────────────────────────────────────────

const { chainId } = await ethers.provider.getNetwork();
const deployments = {
  chainId: Number(chainId),
  usdc: await usdc.getAddress(),
  registry: await registry.getAddress(),
  factory: await factory.getAddress(),
  sales: {
    [await apartments.token.getAddress()]: await sale.getAddress(),
  },
};
await writeFile(
  new URL("../frontend/src/deployments.json", import.meta.url),
  JSON.stringify(deployments, null, 2) + "\n",
);
console.log("Wrote frontend/src/deployments.json");
