// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYieldHook {
    // Called by the property token before balances of `from` and `to` change
    function onTokenTransfer(address from, address to) external;
}
