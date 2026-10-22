// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetRegistry {
    function isActiveToken(address token) external view returns (bool);
}
