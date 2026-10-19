import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();
const { time } = networkHelpers;

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);
const TOKENS = (n: number) => ethers.parseUnits(n.toString(), 18);

const PRICE = USDC(50); // 50 USDC per property token
const SOFT_CAP = TOKENS(100);
const HARD_CAP = TOKENS(1_000);
const MIN_PURCHASE = TOKENS(1);
const DAY = 24 * 60 * 60;

enum State {
  Active,
  Succeeded,
  Failed,
}

async function deploySale() {
  const [admin, issuer, compliance, treasury, alice, bob, outsider] =
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
  await token.setYieldDistributor(await distributor.getAddress());

  const start = (await time.latest()) + DAY;
  const end = start + 7 * DAY;

  const sale = await ethers.deployContract("TokenSale", [
    admin.address,
    await usdc.getAddress(),
    await token.getAddress(),
    treasury.address,
    PRICE,
    SOFT_CAP,
    HARD_CAP,
    MIN_PURCHASE,
    start,
    end,
  ]);

  await token.grantRole(await token.ISSUER_ROLE(), await sale.getAddress());
  await token.grantRole(await token.COMPLIANCE_ROLE(), compliance.address);
  await sale.grantRole(await sale.ISSUER_ROLE(), issuer.address);
  await distributor.grantRole(await distributor.ISSUER_ROLE(), issuer.address);

  for (const s of [alice, bob, outsider]) {
    await usdc.mint(s.address, USDC(100_000));
    await usdc
      .connect(s)
      .approve(await sale.getAddress(), ethers.MaxUint256);
  }
  for (const s of [alice, bob]) {
    await token.connect(compliance).setWhitelist(s.address, true);
  }

  return {
    usdc,
    token,
    distributor,
    sale,
    start,
    end,
    admin,
    issuer,
    compliance,
    treasury,
    alice,
    bob,
    outsider,
  };
}

describe("TokenSale", function () {
  describe("buying", function () {
    it("only accepts purchases inside the sale window", async function () {
      const { sale, alice, end } = await networkHelpers.loadFixture(deploySale);

      await expect(
        sale.connect(alice).buy(TOKENS(10)),
      ).to.be.revertedWith("TokenSale: not open");

      await time.increaseTo(end);
      await expect(
        sale.connect(alice).buy(TOKENS(10)),
      ).to.be.revertedWith("TokenSale: not open");
    });

    it("escrows payment and records the purchase", async function () {
      const { sale, usdc, token, alice, start } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);

      await expect(sale.connect(alice).buy(TOKENS(10)))
        .to.emit(sale, "TokensPurchased")
        .withArgs(alice.address, TOKENS(10), USDC(500));

      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(
        USDC(500),
      );
      expect(await sale.tokensPurchased(alice.address)).to.equal(TOKENS(10));
      expect(await sale.amountPaid(alice.address)).to.equal(USDC(500));
      expect(await sale.tokensSold()).to.equal(TOKENS(10));
      // Nothing is minted until the sale succeeds
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("rejects buyers who are not whitelisted or are frozen", async function () {
      const { sale, compliance, token, alice, outsider, start } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);

      await expect(
        sale.connect(outsider).buy(TOKENS(10)),
      ).to.be.revertedWith("TokenSale: buyer not whitelisted");

      await token.connect(compliance).setFrozen(alice.address, true);
      await expect(
        sale.connect(alice).buy(TOKENS(10)),
      ).to.be.revertedWith("TokenSale: buyer frozen");
    });

    it("enforces the minimum purchase and hard cap", async function () {
      const { sale, alice, bob, start } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);

      await expect(
        sale.connect(alice).buy(MIN_PURCHASE - 1n),
      ).to.be.revertedWith("TokenSale: below minimum");

      await sale.connect(alice).buy(TOKENS(900));
      await expect(
        sale.connect(bob).buy(TOKENS(101)),
      ).to.be.revertedWith("TokenSale: exceeds hard cap");

      await sale.connect(bob).buy(TOKENS(100));
      expect(await sale.isOpen()).to.equal(false);
    });

    it("rounds the cost up so fractional purchases are never free", async function () {
      const { sale } = await networkHelpers.loadFixture(deploySale);
      // 1 wei of token at 50 USDC/token is far below 1 USDC unit
      expect(await sale.quote(1n)).to.equal(1n);
      expect(await sale.quote(TOKENS(1))).to.equal(PRICE);
    });
  });

  describe("successful sale", function () {
    it("releases funds to the treasury and lets buyers claim tokens", async function () {
      const { sale, usdc, token, treasury, alice, bob, start, end } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(TOKENS(80));
      await sale.connect(bob).buy(TOKENS(40));

      await expect(sale.finalize()).to.be.revertedWith(
        "TokenSale: still running",
      );
      await time.increaseTo(end);
      await expect(sale.finalize())
        .to.emit(sale, "SaleFinalized")
        .withArgs(State.Succeeded, TOKENS(120), USDC(6_000));

      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC(6_000));

      await expect(sale.connect(alice).claimTokens())
        .to.emit(sale, "TokensClaimed")
        .withArgs(alice.address, TOKENS(80));
      expect(await token.balanceOf(alice.address)).to.equal(TOKENS(80));

      await expect(
        sale.connect(alice).claimTokens(),
      ).to.be.revertedWith("TokenSale: nothing to claim");
      await expect(sale.connect(bob).refund()).to.be.revertedWith(
        "TokenSale: not failed",
      );
    });

    it("can be finalized early once the hard cap is reached", async function () {
      const { sale, alice, start } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(HARD_CAP);

      await sale.finalize();
      expect(await sale.state()).to.equal(State.Succeeded);
    });

    it("blocks claims by buyers who lost compliance status after buying", async function () {
      const { sale, token, compliance, alice, start, end } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(SOFT_CAP);
      await time.increaseTo(end);
      await sale.finalize();

      await token.connect(compliance).setWhitelist(alice.address, false);
      await expect(
        sale.connect(alice).claimTokens(),
      ).to.be.revertedWith("RWAToken: receiver not whitelisted");
    });

    it("gives sale buyers yield from deposits after they claim", async function () {
      const { sale, distributor, usdc, issuer, alice, bob, start, end } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(TOKENS(75));
      await sale.connect(bob).buy(TOKENS(25));
      await time.increaseTo(end);
      await sale.finalize();
      await sale.connect(alice).claimTokens();
      await sale.connect(bob).claimTokens();

      await usdc.mint(issuer.address, USDC(1_000));
      await usdc
        .connect(issuer)
        .approve(await distributor.getAddress(), USDC(1_000));
      await distributor.connect(issuer).depositRentalIncome(USDC(1_000));

      expect(await distributor.calculatePendingYield(alice.address)).to.equal(
        USDC(750),
      );
      expect(await distributor.calculatePendingYield(bob.address)).to.equal(
        USDC(250),
      );
    });
  });

  describe("failed sale", function () {
    it("refunds buyers when the soft cap is missed", async function () {
      const { sale, usdc, token, alice, start, end } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(TOKENS(50));
      await time.increaseTo(end);

      await sale.finalize();
      expect(await sale.state()).to.equal(State.Failed);

      await expect(
        sale.connect(alice).claimTokens(),
      ).to.be.revertedWith("TokenSale: not succeeded");

      const before = await usdc.balanceOf(alice.address);
      await expect(sale.connect(alice).refund())
        .to.emit(sale, "Refunded")
        .withArgs(alice.address, USDC(2_500));
      expect(await usdc.balanceOf(alice.address)).to.equal(
        before + USDC(2_500),
      );
      expect(await token.balanceOf(alice.address)).to.equal(0n);

      await expect(sale.connect(alice).refund()).to.be.revertedWith(
        "TokenSale: nothing to refund",
      );
    });

    it("lets the issuer cancel and refund everyone", async function () {
      const { sale, issuer, alice, start } =
        await networkHelpers.loadFixture(deploySale);
      await time.increaseTo(start);
      await sale.connect(alice).buy(SOFT_CAP);

      await expect(
        sale.connect(alice).cancel(),
      ).to.be.revertedWithCustomError(sale, "AccessControlUnauthorizedAccount");

      await sale.connect(issuer).cancel();
      expect(await sale.state()).to.equal(State.Failed);
      await expect(sale.connect(alice).buy(TOKENS(1))).to.be.revertedWith(
        "TokenSale: not open",
      );
      await sale.connect(alice).refund();
      await expect(sale.finalize()).to.be.revertedWith(
        "TokenSale: already finalized",
      );
    });
  });

  describe("deployment", function () {
    it("rejects invalid configuration", async function () {
      const [admin, treasury] = await ethers.getSigners();
      const now = await time.latest();
      const args = (overrides: Partial<Record<string, unknown>>) => {
        const base = {
          price: PRICE,
          soft: SOFT_CAP,
          hard: HARD_CAP,
          min: MIN_PURCHASE,
          start: now + DAY,
          end: now + 2 * DAY,
          ...overrides,
        };
        return [
          admin.address,
          admin.address,
          admin.address,
          treasury.address,
          base.price,
          base.soft,
          base.hard,
          base.min,
          base.start,
          base.end,
        ];
      };
      await expect(
        ethers.deployContract("TokenSale", args({ price: 0 })),
      ).to.be.revertedWith("TokenSale: zero price");
      await expect(
        ethers.deployContract("TokenSale", args({ soft: HARD_CAP + 1n })),
      ).to.be.revertedWith("TokenSale: invalid caps");
      await expect(
        ethers.deployContract("TokenSale", args({ min: HARD_CAP + 1n })),
      ).to.be.revertedWith("TokenSale: invalid minimum");
      await expect(
        ethers.deployContract("TokenSale", args({ end: now })),
      ).to.be.revertedWith("TokenSale: invalid window");
    });
  });
});
