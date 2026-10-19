// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/RWAToken.sol";
import "../governance/RWARoles.sol";

// Primary sale of property tokens for USDC.
// Payments are escrowed until the sale is finalized:
//   - soft cap reached → USDC goes to the treasury, buyers claim their tokens
//   - soft cap missed or sale cancelled → buyers claim a full refund
// This contract needs ISSUER_ROLE on the RWAToken so it can mint on claim.
contract TokenSale is RWARoles, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        Active, // accepting purchases while inside the sale window
        Succeeded, // soft cap met — tokens claimable, funds released
        Failed // soft cap missed or cancelled — refunds claimable
    }

    // ── Configuration ────────────────────────────────────────────────────

    IERC20 public immutable paymentToken; // MockUSDC
    RWAToken public immutable propertyToken; // token being sold
    address public immutable treasury; // receives the raise on success

    // USDC (smallest unit) charged per 1e18 property tokens
    uint256 public immutable pricePerToken;

    // Caps and minimum are all in property token units (18 decimals)
    uint256 public immutable softCap;
    uint256 public immutable hardCap;
    uint256 public immutable minPurchase;

    uint64 public immutable startTime;
    uint64 public immutable endTime;

    // ── State ────────────────────────────────────────────────────────────

    State public state;
    uint256 public tokensSold;
    uint256 public totalRaised;

    // Per buyer — property tokens bought but not yet minted to them
    mapping(address => uint256) public tokensPurchased;

    // Per buyer — USDC paid, used for refunds if the sale fails
    mapping(address => uint256) public amountPaid;

    // ── Events ───────────────────────────────────────────────────────────

    event TokensPurchased(
        address indexed buyer,
        uint256 tokenAmount,
        uint256 cost
    );
    event SaleFinalized(State outcome, uint256 tokensSold, uint256 totalRaised);
    event TokensClaimed(address indexed buyer, uint256 tokenAmount);
    event Refunded(address indexed buyer, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address admin,
        address _paymentToken,
        address _propertyToken,
        address _treasury,
        uint256 _pricePerToken,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _minPurchase,
        uint64 _startTime,
        uint64 _endTime
    ) RWARoles(admin) {
        require(_treasury != address(0), "TokenSale: zero treasury");
        require(_pricePerToken > 0, "TokenSale: zero price");
        require(
            _softCap <= _hardCap && _hardCap > 0,
            "TokenSale: invalid caps"
        );
        require(_minPurchase <= _hardCap, "TokenSale: invalid minimum");
        require(_startTime < _endTime, "TokenSale: invalid window");

        paymentToken = IERC20(_paymentToken);
        propertyToken = RWAToken(_propertyToken);
        treasury = _treasury;
        pricePerToken = _pricePerToken;
        softCap = _softCap;
        hardCap = _hardCap;
        minPurchase = _minPurchase;
        startTime = _startTime;
        endTime = _endTime;
    }

    // ── View ─────────────────────────────────────────────────────────────

    // USDC cost of `tokenAmount` property tokens, rounded up so tiny
    // purchases can never be free
    function quote(uint256 tokenAmount) public view returns (uint256) {
        return
            Math.mulDiv(
                tokenAmount,
                pricePerToken,
                1e18,
                Math.Rounding.Ceil
            );
    }

    function isOpen() public view returns (bool) {
        return
            state == State.Active &&
            block.timestamp >= startTime &&
            block.timestamp < endTime &&
            tokensSold < hardCap;
    }

    // ── Investor actions ─────────────────────────────────────────────────

    function buy(uint256 tokenAmount) external nonReentrant {
        require(isOpen(), "TokenSale: not open");
        require(tokenAmount >= minPurchase, "TokenSale: below minimum");
        require(
            tokensSold + tokenAmount <= hardCap,
            "TokenSale: exceeds hard cap"
        );
        // Check compliance up front so buyers can't pay for tokens
        // they would never be allowed to receive
        require(
            propertyToken.whitelist(msg.sender),
            "TokenSale: buyer not whitelisted"
        );
        require(!propertyToken.frozen(msg.sender), "TokenSale: buyer frozen");

        uint256 cost = quote(tokenAmount);

        tokensSold += tokenAmount;
        totalRaised += cost;
        tokensPurchased[msg.sender] += tokenAmount;
        amountPaid[msg.sender] += cost;

        paymentToken.safeTransferFrom(msg.sender, address(this), cost);

        emit TokensPurchased(msg.sender, tokenAmount, cost);
    }

    // Mint purchased tokens to the buyer once the sale has succeeded.
    // Minting goes through RWAToken's compliance checks, so a buyer who has
    // since been removed from the whitelist or frozen cannot claim.
    function claimTokens() external nonReentrant {
        require(state == State.Succeeded, "TokenSale: not succeeded");
        uint256 amount = tokensPurchased[msg.sender];
        require(amount > 0, "TokenSale: nothing to claim");

        tokensPurchased[msg.sender] = 0;
        propertyToken.mint(msg.sender, amount);

        emit TokensClaimed(msg.sender, amount);
    }

    function refund() external nonReentrant {
        require(state == State.Failed, "TokenSale: not failed");
        uint256 amount = amountPaid[msg.sender];
        require(amount > 0, "TokenSale: nothing to refund");

        amountPaid[msg.sender] = 0;
        tokensPurchased[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
    }

    // ── Settlement ───────────────────────────────────────────────────────

    // Anyone can finalize once the window has closed or the hard cap is hit
    function finalize() external nonReentrant {
        require(state == State.Active, "TokenSale: already finalized");
        require(
            block.timestamp >= endTime || tokensSold >= hardCap,
            "TokenSale: still running"
        );

        if (tokensSold >= softCap && tokensSold > 0) {
            state = State.Succeeded;
            paymentToken.safeTransfer(treasury, totalRaised);
        } else {
            state = State.Failed;
        }

        emit SaleFinalized(state, tokensSold, totalRaised);
    }

    // Issuer can abort an active sale; every buyer becomes refundable
    function cancel() external onlyRole(ISSUER_ROLE) {
        require(state == State.Active, "TokenSale: already finalized");
        state = State.Failed;
        emit SaleFinalized(state, tokensSold, totalRaised);
    }
}
