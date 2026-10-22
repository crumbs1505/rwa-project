import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);
const TOKENS = (n: number) => ethers.parseUnits(n.toString(), 18);

async function deployFactory() {
  const [admin, launcher, owner, alice, bob] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC", [admin.address]);
  const registry = await ethers.deployContract("AssetRegistry", [
    admin.address,
  ]);
  const factory = await ethers.deployContract("AssetFactory", [
    admin.address,
    await registry.getAddress(),
    await usdc.getAddress(),
  ]);

  await registry.grantRole(
    await registry.ISSUER_ROLE(),
    await factory.getAddress(),
  );
  await factory.grantRole(await factory.ISSUER_ROLE(), launcher.address);

  return { usdc, registry, factory, admin, launcher, owner, alice, bob };
}

async function createAsset(
  fixture: Awaited<ReturnType<typeof deployFactory>>,
  name = "Main Street Property",
  symbol = "MSP",
) {
  const { factory, launcher, owner } = fixture;
  const params = {
    name,
    symbol,
    valuation: USDC(2_000_000),
    legalDocHash: ethers.keccak256(ethers.toUtf8Bytes(`${symbol}-deed.pdf`)),
    owner: owner.address,
  };

  const [assetId, tokenAddress, distributorAddress] = await factory
    .connect(launcher)
    .createAsset.staticCall(params);
  await factory.connect(launcher).createAsset(params);

  const token = await ethers.getContractAt("RWAToken", tokenAddress);
  const distributor = await ethers.getContractAt(
    "YieldDistributor",
    distributorAddress,
  );
  return { assetId, token, distributor, params };
}

describe("AssetFactory", function () {
  it("deploys, wires and registers a new asset", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { factory, registry, usdc, launcher, owner } = fixture;

    const { assetId, token, distributor, params } = await createAsset(fixture);
    const tokenAddress = await token.getAddress();
    const distributorAddress = await distributor.getAddress();

    expect(assetId).to.equal(0n);
    expect(await token.name()).to.equal(params.name);
    expect(await token.symbol()).to.equal(params.symbol);
    expect(await token.yieldDistributor()).to.equal(distributorAddress);
    expect(await token.assetRegistry()).to.equal(await registry.getAddress());
    expect(await distributor.propertyToken()).to.equal(tokenAddress);
    expect(await distributor.rentalIncomeToken()).to.equal(
      await usdc.getAddress(),
    );
    expect(await factory.distributorOf(tokenAddress)).to.equal(
      distributorAddress,
    );

    const asset = await registry.assets(assetId);
    expect(asset.token).to.equal(tokenAddress);
    expect(asset.valuation).to.equal(params.valuation);
    expect(asset.legalDocHash).to.equal(params.legalDocHash);
    expect(asset.active).to.equal(true);

    await expect(
      factory.connect(launcher).createAsset({ ...params, symbol: "X" }),
    )
      .to.emit(factory, "AssetCreated")
      .withArgs(1n, ethers.isAddress, ethers.isAddress, owner.address);
  });

  it("hands every role to the owner and keeps none for itself", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { factory, owner } = fixture;
    const { token, distributor } = await createAsset(fixture);
    const factoryAddress = await factory.getAddress();

    const admin = await token.DEFAULT_ADMIN_ROLE();
    const issuer = await token.ISSUER_ROLE();
    const compliance = await token.COMPLIANCE_ROLE();
    const pauser = await token.PAUSER_ROLE();

    for (const role of [admin, issuer, compliance, pauser]) {
      expect(await token.hasRole(role, owner.address)).to.equal(true);
    }
    for (const role of [admin, issuer]) {
      expect(await distributor.hasRole(role, owner.address)).to.equal(true);
      expect(await distributor.hasRole(role, factoryAddress)).to.equal(false);
    }
    expect(await token.hasRole(admin, factoryAddress)).to.equal(false);
  });

  it("produces an asset that works end to end", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { usdc, owner, alice, bob } = fixture;
    const { token, distributor } = await createAsset(fixture);

    await token.connect(owner).setWhitelist(alice.address, true);
    await token.connect(owner).setWhitelist(bob.address, true);
    await token.connect(owner).mint(alice.address, TOKENS(60));
    await token.connect(owner).mint(bob.address, TOKENS(40));

    await usdc.mint(owner.address, USDC(1_000));
    await usdc
      .connect(owner)
      .approve(await distributor.getAddress(), USDC(1_000));
    await distributor.connect(owner).depositRentalIncome(USDC(1_000));

    await distributor.connect(alice).claimMyYield();
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC(600));
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(
      USDC(400),
    );
  });

  it("keeps assets independent of each other", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { registry, admin, owner, alice } = fixture;
    const first = await createAsset(fixture, "First", "ONE");
    const second = await createAsset(fixture, "Second", "TWO");

    expect(second.assetId).to.equal(1n);
    expect(await second.token.getAddress()).to.not.equal(
      await first.token.getAddress(),
    );

    // Deactivating one asset blocks minting only for that asset
    await registry.grantRole(await registry.ISSUER_ROLE(), admin.address);
    await registry.connect(admin).deactivateAsset(first.assetId);

    await first.token.connect(owner).setWhitelist(alice.address, true);
    await second.token.connect(owner).setWhitelist(alice.address, true);
    await expect(
      first.token.connect(owner).mint(alice.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: asset not active");
    await second.token.connect(owner).mint(alice.address, TOKENS(1));
  });

  it("only lets launchers create assets", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { factory, alice, owner } = fixture;
    await expect(
      factory.connect(alice).createAsset({
        name: "X",
        symbol: "X",
        valuation: 1,
        legalDocHash: ethers.ZeroHash,
        owner: owner.address,
      }),
    ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
  });

  it("rejects a zero owner and bad constructor arguments", async function () {
    const fixture = await networkHelpers.loadFixture(deployFactory);
    const { factory, launcher, admin, registry } = fixture;

    await expect(
      factory.connect(launcher).createAsset({
        name: "X",
        symbol: "X",
        valuation: 1,
        legalDocHash: ethers.ZeroHash,
        owner: ethers.ZeroAddress,
      }),
    ).to.be.revertedWith("AssetFactory: zero owner");

    await expect(
      ethers.deployContract("AssetFactory", [
        admin.address,
        ethers.ZeroAddress,
        admin.address,
      ]),
    ).to.be.revertedWith("AssetFactory: zero registry");
    await expect(
      ethers.deployContract("AssetFactory", [
        admin.address,
        await registry.getAddress(),
        ethers.ZeroAddress,
      ]),
    ).to.be.revertedWith("AssetFactory: zero payment token");
  });
});
