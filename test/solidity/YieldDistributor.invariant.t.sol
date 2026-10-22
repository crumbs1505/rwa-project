// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../contracts/core/RWAToken.sol";
import "../../contracts/finance/MockUSDC.sol";
import "../../contracts/finance/YieldDistributor.sol";

// Drives random sequences of mints, burns, transfers, deposits, claims and
// wallet recoveries against the token + distributor pair
contract YieldHandler is Test {
    RWAToken public token;
    YieldDistributor public distributor;
    MockUSDC public usdc;

    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];

    // Ghost accounting
    uint256 public totalDeposited;
    uint256 public totalClaimed;
    // Upper bound on yield lost to integer rounding across all deposits
    uint256 public roundingAllowance;

    uint256 constant MAX_SUPPLY = 1_000_000e18;

    constructor(RWAToken _token, YieldDistributor _distributor, MockUSDC _usdc) {
        token = _token;
        distributor = _distributor;
        usdc = _usdc;
    }

    function actorCount() external pure returns (uint256) {
        return 3;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 3];
    }

    function mint(uint256 actorSeed, uint256 amount) external {
        uint256 room = MAX_SUPPLY - token.totalSupply();
        if (room == 0) return;
        amount = bound(amount, 1, room);
        token.mint(_actor(actorSeed), amount);
    }

    function burn(uint256 actorSeed, uint256 amount) external {
        address holder = _actor(actorSeed);
        uint256 balance = token.balanceOf(holder);
        if (balance == 0) return;
        token.burn(holder, bound(amount, 1, balance));
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 balance = token.balanceOf(from);
        if (balance == 0 || !token.whitelist(from) || !token.whitelist(to)) return;
        vm.prank(from);
        token.transfer(to, bound(amount, 1, balance));
    }

    function deposit(uint256 amount) external {
        uint256 supply = token.totalSupply();
        if (supply == 0) return;
        amount = bound(amount, 1, 1_000_000e6);
        usdc.mint(address(this), amount);
        usdc.approve(address(distributor), amount);
        distributor.depositRentalIncome(amount);

        totalDeposited += amount;
        // cumulativeYieldPerToken floors (≤ supply/1e18 units lost overall)
        // and each holder's share floors again (≤ 1 unit per holder)
        roundingAllowance += supply / 1e18 + 1 + 3;
    }

    function claim(uint256 actorSeed) external {
        address holder = _actor(actorSeed);
        uint256 owed = distributor.calculatePendingYield(holder);
        if (owed == 0) return;
        vm.prank(holder);
        distributor.claimMyYield();
        totalClaimed += owed;
    }

    // Recover one actor's wallet onto another, then re-whitelist the lost
    // one so later calls can keep using all three actors
    function recover(uint256 fromSeed, uint256 toSeed) external {
        address lost = _actor(fromSeed);
        address replacement = _actor(toSeed);
        if (lost == replacement) return;
        token.recoverWallet(lost, replacement);
        token.setWhitelist(lost, true);
    }
}

contract YieldDistributorInvariantTest is Test {
    RWAToken token;
    YieldDistributor distributor;
    MockUSDC usdc;
    YieldHandler handler;

    function setUp() public {
        usdc = new MockUSDC(address(this));
        token = new RWAToken("Property", "PROP", address(this));
        distributor = new YieldDistributor(address(this), address(usdc), address(token));
        token.setYieldDistributor(address(distributor));

        handler = new YieldHandler(token, distributor, usdc);
        usdc.transferOwnership(address(handler));
        token.grantRole(token.DEFAULT_ADMIN_ROLE(), address(handler));
        token.grantRole(token.ISSUER_ROLE(), address(handler));
        token.grantRole(token.COMPLIANCE_ROLE(), address(handler));
        distributor.grantRole(distributor.ISSUER_ROLE(), address(handler));

        token.grantRole(token.COMPLIANCE_ROLE(), address(this));
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            token.setWhitelist(handler.actors(i), true);
        }

        targetContract(address(handler));
    }

    function _totalPending() internal view returns (uint256 sum) {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            sum += distributor.calculatePendingYield(handler.actors(i));
        }
    }

    // Every USDC that came in is either paid out or still held
    function invariant_fundsAreConserved() public view {
        assertEq(
            handler.totalClaimed() + usdc.balanceOf(address(distributor)),
            handler.totalDeposited()
        );
    }

    // The distributor can always pay everyone what it says they are owed
    function invariant_solvent() public view {
        assertLe(_totalPending(), usdc.balanceOf(address(distributor)));
    }

    // Holders lose at most rounding dust: claimed + owed ≈ deposited
    function invariant_noYieldLostBeyondRounding() public view {
        uint256 accountedFor = handler.totalClaimed() + _totalPending();
        assertLe(accountedFor, handler.totalDeposited());
        assertLe(handler.totalDeposited() - accountedFor, handler.roundingAllowance());
    }
}
