import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);
const TOKENS = (n: number) => ethers.parseUnits(n.toString(), 18);

async function deploySystem() {
  const [admin, issuer, compliance, pauser, alice, bob, carol] =
    await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC", [admin.address]);
  const token = await ethers.deployContract("RWAToken", [
    "Main Street Property",
    "MSP",
    admin.address,
  ]);
  const distributor = await ethers.deployContract("YieldDistributor", [
    admin.address,
    await usdc.getAddress(),
    await token.getAddress(),
  ]);
  const registry = await ethers.deployContract("AssetRegistry", [
    admin.address,
  ]);

  await token.setYieldDistributor(await distributor.getAddress());

  await token.grantRole(await token.ISSUER_ROLE(), issuer.address);
  await token.grantRole(await token.COMPLIANCE_ROLE(), compliance.address);
  await token.grantRole(await token.PAUSER_ROLE(), pauser.address);
  await distributor.grantRole(await distributor.ISSUER_ROLE(), issuer.address);
  await registry.grantRole(await registry.ISSUER_ROLE(), issuer.address);

  for (const s of [alice, bob, carol]) {
    await token.connect(compliance).setWhitelist(s.address, true);
  }

  // Issuer holds rental income and pre-approves the distributor
  await usdc.mint(issuer.address, USDC(1_000_000));
  await usdc
    .connect(issuer)
    .approve(await distributor.getAddress(), ethers.MaxUint256);

  return {
    usdc,
    token,
    distributor,
    registry,
    admin,
    issuer,
    compliance,
    pauser,
    alice,
    bob,
    carol,
  };
}

describe("RWAToken", function () {
  it("only lets the issuer mint and burn", async function () {
    const { token, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);

    await expect(
      token.connect(alice).mint(alice.address, TOKENS(1)),
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await token.connect(issuer).burn(alice.address, TOKENS(4));
    expect(await token.balanceOf(alice.address)).to.equal(TOKENS(6));
  });

  it("blocks transfers to and from non-whitelisted accounts", async function () {
    const { token, issuer, compliance, alice, bob, carol } =
      await networkHelpers.loadFixture(deploySystem);
    const [, , , , , , , outsider] = await ethers.getSigners();

    await expect(
      token.connect(issuer).mint(outsider.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: receiver not whitelisted");

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await expect(
      token.connect(alice).transfer(outsider.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: receiver not whitelisted");

    await token.connect(alice).transfer(bob.address, TOKENS(1));
    await token.connect(compliance).setWhitelist(bob.address, false);
    await expect(
      token.connect(bob).transfer(carol.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: sender not whitelisted");
  });

  it("blocks transfers involving frozen accounts", async function () {
    const { token, issuer, compliance, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await token.connect(compliance).setFrozen(alice.address, true);
    await expect(
      token.connect(alice).transfer(bob.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: sender frozen");

    await token.connect(compliance).setFrozen(alice.address, false);
    await token.connect(compliance).setFrozen(bob.address, true);
    await expect(
      token.connect(alice).transfer(bob.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: receiver frozen");
  });

  it("halts all transfers while paused", async function () {
    const { token, issuer, pauser, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await token.connect(pauser).pause();
    await expect(
      token.connect(alice).transfer(bob.address, TOKENS(1)),
    ).to.be.revertedWithCustomError(token, "EnforcedPause");

    await token.connect(pauser).unpause();
    await token.connect(alice).transfer(bob.address, TOKENS(1));
    expect(await token.balanceOf(bob.address)).to.equal(TOKENS(1));
  });

  it("only mints while the asset is active in the registry", async function () {
    const { token, registry, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);
    const tokenAddress = await token.getAddress();
    await token.setAssetRegistry(await registry.getAddress());

    // Not registered yet
    await expect(
      token.connect(issuer).mint(alice.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: asset not active");

    await registry
      .connect(issuer)
      .registerAsset("A", 1, ethers.ZeroHash, tokenAddress);
    await token.connect(issuer).mint(alice.address, TOKENS(1));

    await registry.connect(issuer).deactivateAsset(0);
    await expect(
      token.connect(issuer).mint(alice.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: asset not active");

    // Existing holders can still be burned or redeemed
    await token.connect(issuer).burn(alice.address, TOKENS(1));
  });

  it("only lets the admin set the asset registry", async function () {
    const { token, alice } = await networkHelpers.loadFixture(deploySystem);
    await expect(
      token.connect(alice).setAssetRegistry(alice.address),
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("only lets the admin set the yield distributor", async function () {
    const { token, alice } = await networkHelpers.loadFixture(deploySystem);
    await expect(
      token.connect(alice).setYieldDistributor(alice.address),
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });
});

describe("YieldDistributor", function () {
  it("splits rental income pro rata", async function () {
    const { token, distributor, usdc, issuer, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(75));
    await token.connect(issuer).mint(bob.address, TOKENS(25));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));

    expect(await distributor.calculatePendingYield(alice.address)).to.equal(
      USDC(750),
    );
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(
      USDC(250),
    );

    await expect(distributor.connect(alice).claimMyYield())
      .to.emit(distributor, "YieldClaimed")
      .withArgs(alice.address, USDC(750));
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC(750));
    expect(await distributor.calculatePendingYield(alice.address)).to.equal(0n);

    await expect(
      distributor.connect(alice).claimMyYield(),
    ).to.be.revertedWith("YieldDistributor: nothing to claim");
  });

  it("does not pay a buyer for yield earned before they held tokens", async function () {
    const { token, distributor, usdc, issuer, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(100));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));

    // Alice sells everything to Bob after the deposit
    await token.connect(alice).transfer(bob.address, TOKENS(100));

    expect(await distributor.calculatePendingYield(alice.address)).to.equal(
      USDC(1_000),
    );
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(0n);

    await distributor.connect(issuer).depositRentalIncome(USDC(500));
    expect(await distributor.calculatePendingYield(alice.address)).to.equal(
      USDC(1_000),
    );
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(
      USDC(500),
    );

    await distributor.connect(alice).claimMyYield();
    await distributor.connect(bob).claimMyYield();
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC(1_000));
    expect(await usdc.balanceOf(bob.address)).to.equal(USDC(500));
    expect(await usdc.balanceOf(await distributor.getAddress())).to.equal(0n);
  });

  it("cannot be drained by passing tokens between wallets", async function () {
    const { token, distributor, usdc, issuer, alice, bob, carol } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(50));
    await token.connect(issuer).mint(carol.address, TOKENS(50));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));

    await distributor.connect(alice).claimMyYield();
    await token.connect(alice).transfer(bob.address, TOKENS(50));
    await expect(
      distributor.connect(bob).claimMyYield(),
    ).to.be.revertedWith("YieldDistributor: nothing to claim");

    // Carol's share is still fully backed
    await distributor.connect(carol).claimMyYield();
    expect(await usdc.balanceOf(carol.address)).to.equal(USDC(500));
  });

  it("gives newly minted tokens no share of past deposits", async function () {
    const { token, distributor, issuer, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(100));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));
    await token.connect(issuer).mint(bob.address, TOKENS(100));

    expect(await distributor.calculatePendingYield(bob.address)).to.equal(0n);

    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));
    expect(await distributor.calculatePendingYield(alice.address)).to.equal(
      USDC(1_500),
    );
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(
      USDC(500),
    );
  });

  it("keeps accrued yield after tokens are burned", async function () {
    const { token, distributor, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(100));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));
    await token.connect(issuer).burn(alice.address, TOKENS(100));

    expect(await distributor.calculatePendingYield(alice.address)).to.equal(
      USDC(1_000),
    );
  });

  it("rejects deposits before any tokens exist", async function () {
    const { distributor, issuer } =
      await networkHelpers.loadFixture(deploySystem);
    await expect(
      distributor.connect(issuer).depositRentalIncome(USDC(1)),
    ).to.be.revertedWith("YieldDistributor: no token holders yet");
  });

  it("only lets the issuer deposit", async function () {
    const { token, distributor, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);
    await token.connect(issuer).mint(alice.address, TOKENS(1));
    await expect(
      distributor.connect(alice).depositRentalIncome(USDC(1)),
    ).to.be.revertedWithCustomError(
      distributor,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("only accepts the transfer hook from the property token", async function () {
    const { distributor, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);
    await expect(
      distributor.connect(alice).onTokenTransfer(alice.address, bob.address),
    ).to.be.revertedWith("YieldDistributor: caller is not the property token");
  });
});

describe("AssetRegistry", function () {
  it("registers and deactivates assets", async function () {
    const { registry, token, issuer } =
      await networkHelpers.loadFixture(deploySystem);
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("deed.pdf"));

    await expect(
      registry
        .connect(issuer)
        .registerAsset(
          "Main Street Property",
          USDC(2_000_000),
          docHash,
          await token.getAddress(),
        ),
    )
      .to.emit(registry, "AssetRegistered")
      .withArgs(0n, "Main Street Property", await token.getAddress());

    let asset = await registry.assets(0);
    expect(asset.legalDocHash).to.equal(docHash);
    expect(asset.active).to.equal(true);
    expect(await registry.assetCount()).to.equal(1n);

    await registry.connect(issuer).deactivateAsset(0);
    asset = await registry.assets(0);
    expect(asset.active).to.equal(false);
  });

  it("rejects unknown asset ids and non-issuers", async function () {
    const { registry, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);

    await expect(
      registry.connect(issuer).deactivateAsset(0),
    ).to.be.revertedWith("AssetRegistry: unknown asset");
    await expect(
      registry
        .connect(alice)
        .registerAsset("X", 1, ethers.ZeroHash, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("looks assets up by token and tracks whether they are active", async function () {
    const { registry, token, issuer } =
      await networkHelpers.loadFixture(deploySystem);
    const tokenAddress = await token.getAddress();

    expect(await registry.isActiveToken(tokenAddress)).to.equal(false);
    await expect(registry.assetIdOf(tokenAddress)).to.be.revertedWith(
      "AssetRegistry: token not registered",
    );

    await registry
      .connect(issuer)
      .registerAsset("Main Street Property", 1, ethers.ZeroHash, tokenAddress);
    expect(await registry.assetIdOf(tokenAddress)).to.equal(0n);
    expect(await registry.isActiveToken(tokenAddress)).to.equal(true);

    await registry.connect(issuer).deactivateAsset(0);
    expect(await registry.isActiveToken(tokenAddress)).to.equal(false);
  });

  it("rejects duplicate and zero-address tokens", async function () {
    const { registry, token, issuer } =
      await networkHelpers.loadFixture(deploySystem);
    const tokenAddress = await token.getAddress();

    await registry
      .connect(issuer)
      .registerAsset("A", 1, ethers.ZeroHash, tokenAddress);
    await expect(
      registry.connect(issuer).registerAsset("B", 1, ethers.ZeroHash, tokenAddress),
    ).to.be.revertedWith("AssetRegistry: token already registered");
    await expect(
      registry
        .connect(issuer)
        .registerAsset("C", 1, ethers.ZeroHash, ethers.ZeroAddress),
    ).to.be.revertedWith("AssetRegistry: zero token");
  });

  it("lets the issuer update an asset's valuation", async function () {
    const { registry, token, issuer, alice } =
      await networkHelpers.loadFixture(deploySystem);
    await registry
      .connect(issuer)
      .registerAsset("A", USDC(1_000_000), ethers.ZeroHash, await token.getAddress());

    await expect(registry.connect(issuer).updateValuation(0, USDC(1_200_000)))
      .to.emit(registry, "ValuationUpdated")
      .withArgs(0n, USDC(1_200_000));
    expect((await registry.assets(0)).valuation).to.equal(USDC(1_200_000));

    await expect(
      registry.connect(issuer).updateValuation(1, 1),
    ).to.be.revertedWith("AssetRegistry: unknown asset");
    await expect(
      registry.connect(alice).updateValuation(0, 1),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });
});

describe("Forced transfer and recovery", function () {
  it("lets the issuer burn tokens from a frozen account", async function () {
    const { token, issuer, compliance, alice } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await token.connect(compliance).setFrozen(alice.address, true);
    await token.connect(compliance).setWhitelist(alice.address, false);

    await token.connect(issuer).burn(alice.address, TOKENS(10));
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  it("lets compliance force a transfer out of a frozen account", async function () {
    const { token, issuer, compliance, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await token.connect(compliance).setFrozen(alice.address, true);

    await expect(
      token
        .connect(compliance)
        .forcedTransfer(alice.address, bob.address, TOKENS(4)),
    )
      .to.emit(token, "ForcedTransfer")
      .withArgs(alice.address, bob.address, TOKENS(4));
    expect(await token.balanceOf(bob.address)).to.equal(TOKENS(4));

    // Sender checks are restored afterwards
    await expect(
      token.connect(alice).transfer(bob.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: sender frozen");
  });

  it("still checks the receiver of a forced transfer", async function () {
    const { token, issuer, compliance, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);
    const [, , , , , , , outsider] = await ethers.getSigners();

    await token.connect(issuer).mint(alice.address, TOKENS(10));
    await expect(
      token
        .connect(compliance)
        .forcedTransfer(alice.address, outsider.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: receiver not whitelisted");

    await token.connect(compliance).setFrozen(bob.address, true);
    await expect(
      token
        .connect(compliance)
        .forcedTransfer(alice.address, bob.address, TOKENS(1)),
    ).to.be.revertedWith("RWAToken: receiver frozen");
  });

  it("only lets compliance force transfers and recover wallets", async function () {
    const { token, issuer, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await expect(
      token.connect(issuer).forcedTransfer(alice.address, bob.address, 1n),
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    await expect(
      token.connect(issuer).recoverWallet(alice.address, bob.address),
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("recovers a lost wallet's tokens and unclaimed yield", async function () {
    const { token, distributor, usdc, issuer, compliance, alice, bob, carol } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(60));
    await token.connect(issuer).mint(carol.address, TOKENS(40));
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));

    // Alice loses her keys; Bob is her new, already-whitelisted wallet
    await expect(
      token.connect(compliance).recoverWallet(alice.address, bob.address),
    )
      .to.emit(token, "WalletRecovered")
      .withArgs(alice.address, bob.address, TOKENS(60));

    expect(await token.balanceOf(alice.address)).to.equal(0n);
    expect(await token.balanceOf(bob.address)).to.equal(TOKENS(60));
    expect(await token.whitelist(alice.address)).to.equal(false);
    expect(await distributor.calculatePendingYield(alice.address)).to.equal(0n);
    expect(await distributor.calculatePendingYield(bob.address)).to.equal(
      USDC(600),
    );

    // Future yield accrues to the new wallet
    await distributor.connect(issuer).depositRentalIncome(USDC(1_000));
    await distributor.connect(bob).claimMyYield();
    expect(await usdc.balanceOf(bob.address)).to.equal(USDC(1_200));
    await expect(
      distributor.connect(alice).claimMyYield(),
    ).to.be.revertedWith("YieldDistributor: nothing to claim");
  });

  it("recovers a frozen wallet", async function () {
    const { token, issuer, compliance, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);

    await token.connect(issuer).mint(alice.address, TOKENS(5));
    await token.connect(compliance).setFrozen(alice.address, true);
    await token.connect(compliance).recoverWallet(alice.address, bob.address);
    expect(await token.balanceOf(bob.address)).to.equal(TOKENS(5));
  });

  it("rejects recovering a wallet onto itself", async function () {
    const { token, compliance, alice } =
      await networkHelpers.loadFixture(deploySystem);
    await expect(
      token.connect(compliance).recoverWallet(alice.address, alice.address),
    ).to.be.revertedWith("RWAToken: same wallet");
  });

  it("only accepts the recovery hook from the property token", async function () {
    const { distributor, alice, bob } =
      await networkHelpers.loadFixture(deploySystem);
    await expect(
      distributor.connect(alice).onWalletRecovered(alice.address, bob.address),
    ).to.be.revertedWith("YieldDistributor: caller is not the property token");
  });
});
