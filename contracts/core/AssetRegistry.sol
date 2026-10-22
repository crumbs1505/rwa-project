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

    // token → assetId + 1, so 0 means "not registered"
    mapping(address => uint256) private _assetIdPlusOne;

    event AssetRegistered(uint256 indexed assetId, string name, address token);
    event AssetDeactivated(uint256 indexed assetId);
    event ValuationUpdated(uint256 indexed assetId, uint256 valuation);

    constructor(address admin) RWARoles(admin) {}

    function registerAsset(
        string calldata name,
        uint256 valuation,
        bytes32 legalDocHash,
        address token
    ) external onlyRole(ISSUER_ROLE) returns (uint256 assetId) {
        require(token != address(0), "AssetRegistry: zero token");
        require(
            _assetIdPlusOne[token] == 0,
            "AssetRegistry: token already registered"
        );
        assetId = assetCount++;
        assets[assetId] = Asset(name, valuation, legalDocHash, token, true);
        _assetIdPlusOne[token] = assetId + 1;
        emit AssetRegistered(assetId, name, token);
    }

    function deactivateAsset(uint256 assetId) external onlyRole(ISSUER_ROLE) {
        require(assetId < assetCount, "AssetRegistry: unknown asset");
        assets[assetId].active = false;
        emit AssetDeactivated(assetId);
    }

    // Record a new appraisal of the asset (same units as at registration)
    function updateValuation(
        uint256 assetId,
        uint256 valuation
    ) external onlyRole(ISSUER_ROLE) {
        require(assetId < assetCount, "AssetRegistry: unknown asset");
        assets[assetId].valuation = valuation;
        emit ValuationUpdated(assetId, valuation);
    }

    function assetIdOf(address token) external view returns (uint256) {
        uint256 idPlusOne = _assetIdPlusOne[token];
        require(idPlusOne != 0, "AssetRegistry: token not registered");
        return idPlusOne - 1;
    }

    // False for unregistered tokens as well as deactivated assets
    function isActiveToken(address token) external view returns (bool) {
        uint256 idPlusOne = _assetIdPlusOne[token];
        return idPlusOne != 0 && assets[idPlusOne - 1].active;
    }
}
