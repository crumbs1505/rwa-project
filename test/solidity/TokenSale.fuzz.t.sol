// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../contracts/finance/TokenSale.sol";

contract TokenSaleFuzzTest is Test {
    function _sale(uint256 price) internal returns (TokenSale) {
        return
            new TokenSale(
                address(this),
                address(1),
                address(2),
                address(3),
                price,
                0,
                type(uint128).max,
                0,
                uint64(block.timestamp),
                uint64(block.timestamp + 1)
            );
    }

    // quote() is the smallest USDC amount that covers amount × price
    function testFuzz_quoteRoundsUpExactly(uint256 amount, uint256 price) public {
        amount = bound(amount, 0, 1e30); // up to a trillion tokens
        price = bound(price, 1, 1e15); // up to a billion USDC per token
        TokenSale sale = _sale(price);

        uint256 cost = sale.quote(amount);
        uint256 exact = amount * price; // scaled by 1e18

        assertGe(cost * 1e18, exact, "undercharged");
        if (cost > 0) {
            assertLt((cost - 1) * 1e18, exact, "overcharged");
        }
        if (amount > 0) {
            assertGt(cost, 0, "free tokens");
        }
    }

    // Buying in two parts never costs less than buying in one go
    function testFuzz_splittingNeverSaves(uint256 a, uint256 b, uint256 price) public {
        a = bound(a, 0, 1e30);
        b = bound(b, 0, 1e30);
        price = bound(price, 1, 1e15);
        TokenSale sale = _sale(price);

        assertGe(sale.quote(a) + sale.quote(b), sale.quote(a + b));
    }
}
