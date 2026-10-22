// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AssetRegistry.sol";
import "./RWAToken.sol";
import "../finance/YieldDistributor.sol";
import "../governance/RWARoles.sol";

// Launches a new tokenized property in one transaction:
//   1. deploys its RWAToken and YieldDistributor
//   2. wires the token to the distributor and the registry
//   3. registers the asset
//   4. hands every role to the asset owner and drops its own
// The factory needs ISSUER_ROLE on the AssetRegistry.
contract AssetFactory is RWARoles {
    struct AssetParams {
        string name;
        string symbol;
        uint256 valuation;
        bytes32 legalDocHash;
        address owner; // receives admin and all operational roles
    }

    AssetRegistry public immutable registry;
    address public immutable paymentToken; // stablecoin yield is paid in

    // token → its YieldDistributor
    mapping(address => address) public distributorOf;

    event AssetCreated(
        uint256 indexed assetId,
        address indexed token,
        address distributor,
        address indexed owner
    );

    constructor(
        address admin,
        address _registry,
        address _paymentToken
    ) RWARoles(admin) {
        require(_registry != address(0), "AssetFactory: zero registry");
        require(_paymentToken != address(0), "AssetFactory: zero payment token");
        registry = AssetRegistry(_registry);
        paymentToken = _paymentToken;
    }

    function createAsset(
        AssetParams calldata params
    )
        external
        onlyRole(ISSUER_ROLE)
        returns (uint256 assetId, address token, address distributor)
    {
        require(params.owner != address(0), "AssetFactory: zero owner");

        // The factory is admin of both contracts until setup is finished
        RWAToken rwaToken = new RWAToken(
            params.name,
            params.symbol,
            address(this)
        );
        YieldDistributor yieldDistributor = new YieldDistributor(
            address(this),
            paymentToken,
            address(rwaToken)
        );
        token = address(rwaToken);
        distributor = address(yieldDistributor);

        rwaToken.setYieldDistributor(distributor);
        rwaToken.setAssetRegistry(address(registry));

        assetId = registry.registerAsset(
            params.name,
            params.valuation,
            params.legalDocHash,
            token
        );
        distributorOf[token] = distributor;

        // Grant token-only roles before the factory gives up its admin
        rwaToken.grantRole(COMPLIANCE_ROLE, params.owner);
        rwaToken.grantRole(PAUSER_ROLE, params.owner);
        _handOver(rwaToken, params.owner);
        _handOver(yieldDistributor, params.owner);

        emit AssetCreated(assetId, token, distributor, params.owner);
    }

    // Give `owner` admin + issuer rights and remove the factory's admin
    function _handOver(RWARoles target, address owner) private {
        target.grantRole(DEFAULT_ADMIN_ROLE, owner);
        target.grantRole(ISSUER_ROLE, owner);
        target.renounceRole(DEFAULT_ADMIN_ROLE, address(this));
    }
}
