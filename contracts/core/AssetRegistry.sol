// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../governance/RWARoles.sol";

contract AssetRegistry is RWARoles {
    struct Asset {
        string name;
        uint256 valuation;
        bytes32 legalDocHash;
        address token;
        bool active;
    }

    uint256 public assetCount;
    mapping(uint256 => Asset) public assets;

    event AssetRegistered(uint256 indexed assetId, string name, address token);
    event AssetDeactivated(uint256 indexed assetId);

    constructor(address admin) RWARoles(admin) {}

    function registerAsset(
        string calldata name,
        uint256 valuation,
        bytes32 legalDocHash,
        address token
    ) external onlyRole(ISSUER_ROLE) returns (uint256 assetId) {
        assetId = assetCount++;
        assets[assetId] = Asset(name, valuation, legalDocHash, token, true);
        emit AssetRegistered(assetId, name, token);
    }

    function deactivateAsset(uint256 assetId) external onlyRole(ISSUER_ROLE) {
        assets[assetId].active = false;
        emit AssetDeactivated(assetId);
    }
}
