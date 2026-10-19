// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYieldHook {
    // Called by the property token before balances of `from` and `to` change
    function onTokenTransfer(address from, address to) external;

    // Called by the property token after a lost wallet's balance has been
    // moved, so unclaimed yield follows the investor to the new wallet
    function onWalletRecovered(address lostWallet, address newWallet) external;
}
