// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../governance/RWARoles.sol";

contract YieldDistributor is RWARoles, ReentrancyGuard {
    // ── State ────────────────────────────────────────────────────────────

    IERC20 public immutable rentalIncomeToken; // MockUSDC — the token yield is paid in
    IERC20 public immutable propertyToken; // RWAToken — used to check holder balances

    // Global accumulator — grows every time rent is deposited
    // Represents total yield ever earned per single property token (scaled by 1e18)
    uint256 public cumulativeYieldPerToken;

    // Total USDC ever deposited into this contract across all time
    uint256 public totalRentalIncomeDeposited;

    // Per user — snapshot of cumulativeYieldPerToken at the time they last interacted
    mapping(address => uint256) public yieldPerTokenSnapshots;

    // Per user — USDC sitting ready to be withdrawn
    mapping(address => uint256) public pendingYield;

    // ── Events ───────────────────────────────────────────────────────────

    event RentalIncomeDeposited(uint256 amount);
    event YieldClaimed(address indexed holder, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address admin,
        address _rentalIncomeToken,
        address _propertyToken
    ) RWARoles(admin) {
        rentalIncomeToken = IERC20(_rentalIncomeToken);
        propertyToken = IERC20(_propertyToken);
    }

    // ── View ─────────────────────────────────────────────────────────────

    // How much USDC can this holder claim right now?
    function calculatePendingYield(
        address holder
    ) public view returns (uint256) {
        uint256 holderBalance = propertyToken.balanceOf(holder);
        uint256 yieldEarnedSinceLastSnapshot = (holderBalance *
            (cumulativeYieldPerToken - yieldPerTokenSnapshots[holder])) / 1e18;
        return yieldEarnedSinceLastSnapshot + pendingYield[holder];
    }

    // ── Issuer actions ───────────────────────────────────────────────────

    // Called monthly by the issuer when rental income arrives
    // Increases every holder's claimable amount proportionally
    function depositRentalIncome(
        uint256 amount
    ) external onlyRole(ISSUER_ROLE) {
        uint256 totalTokensInCirculation = propertyToken.totalSupply();
        require(
            totalTokensInCirculation > 0,
            "YieldDistributor: no token holders yet"
        );

        // How much does each token earn from this deposit?
        // Multiply first to preserve precision (Solidity has no decimals)
        cumulativeYieldPerToken += (amount * 1e18) / totalTokensInCirculation;
        totalRentalIncomeDeposited += amount;

        // Pull USDC from issuer into this contract
        rentalIncomeToken.transferFrom(msg.sender, address(this), amount);

        emit RentalIncomeDeposited(amount);
    }

    // ── Holder actions ───────────────────────────────────────────────────

    // Called by a token holder to withdraw their accumulated rental income
    function claimMyYield() external nonReentrant {
        // Step 1 — calculate and snapshot before changing anything
        _snapshotHolderYield(msg.sender);

        // Step 2 — read what they are owed
        uint256 amountOwed = pendingYield[msg.sender];
        require(amountOwed > 0, "YieldDistributor: nothing to claim");

        // Step 3 — zero out before transferring (prevents reentrancy)
        pendingYield[msg.sender] = 0;

        // Step 4 — send USDC to holder
        rentalIncomeToken.transfer(msg.sender, amountOwed);

        emit YieldClaimed(msg.sender, amountOwed);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    // Calculates what the holder is owed up to this moment
    // and updates their snapshot so future earnings start from here
    function _snapshotHolderYield(address holder) internal {
        pendingYield[holder] = calculatePendingYield(holder);
        yieldPerTokenSnapshots[holder] = cumulativeYieldPerToken;
    }
}
