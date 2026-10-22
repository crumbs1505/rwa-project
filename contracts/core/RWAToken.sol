// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "../governance/RWARoles.sol";
import "../interfaces/IYieldHook.sol";
import "../interfaces/IAssetRegistry.sol";

contract RWAToken is ERC20Pausable, RWARoles {
    mapping(address => bool) public whitelist;
    mapping(address => bool) public frozen;

    // Notified before every balance change so yield is settled on old balances
    IYieldHook public yieldDistributor;

    // When set, new tokens can only be minted while the asset is active
    IAssetRegistry public assetRegistry;

    // Set only for the duration of an issuer burn or compliance-forced move,
    // so _update skips the sender checks (the sender may be frozen)
    bool private _skipSenderChecks;

    event WhitelistUpdated(address indexed account, bool status);
    event FrozenUpdated(address indexed account, bool status);
    event YieldDistributorUpdated(address indexed distributor);
    event AssetRegistryUpdated(address indexed registry);
    event ForcedTransfer(
        address indexed from,
        address indexed to,
        uint256 amount
    );
    event WalletRecovered(
        address indexed lostWallet,
        address indexed newWallet,
        uint256 amount
    );

    constructor(
        string memory name,
        string memory symbol,
        address admin
    ) ERC20(name, symbol) RWARoles(admin) {}

    function mint(address to, uint256 amount) external onlyRole(ISSUER_ROLE) {
        require(
            address(assetRegistry) == address(0) ||
                assetRegistry.isActiveToken(address(this)),
            "RWAToken: asset not active"
        );
        _mint(to, amount);
    }

    // Burning works on frozen or de-whitelisted accounts so the issuer
    // can seize or redeem tokens from them
    function burn(address from, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _skipSenderChecks = true;
        _burn(from, amount);
        _skipSenderChecks = false;
    }

    // Move tokens out of any account, e.g. on a court order. The receiver
    // must still be whitelisted and not frozen.
    function forcedTransfer(
        address from,
        address to,
        uint256 amount
    ) external onlyRole(COMPLIANCE_ROLE) {
        _forcedTransfer(from, to, amount);
        emit ForcedTransfer(from, to, amount);
    }

    // Move an investor's whole position, including unclaimed yield, from a
    // lost wallet to a replacement wallet that compliance has already
    // whitelisted. The lost wallet is removed from the whitelist.
    function recoverWallet(
        address lostWallet,
        address newWallet
    ) external onlyRole(COMPLIANCE_ROLE) {
        require(lostWallet != newWallet, "RWAToken: same wallet");
        uint256 amount = balanceOf(lostWallet);

        _forcedTransfer(lostWallet, newWallet, amount);
        if (address(yieldDistributor) != address(0)) {
            yieldDistributor.onWalletRecovered(lostWallet, newWallet);
        }

        whitelist[lostWallet] = false;
        emit WhitelistUpdated(lostWallet, false);
        emit WalletRecovered(lostWallet, newWallet, amount);
    }

    function setWhitelist(
        address account,
        bool status
    ) external onlyRole(COMPLIANCE_ROLE) {
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }

    function setFrozen(
        address account,
        bool status
    ) external onlyRole(COMPLIANCE_ROLE) {
        frozen[account] = status;
        emit FrozenUpdated(account, status);
    }

    function setYieldDistributor(
        address distributor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        yieldDistributor = IYieldHook(distributor);
        emit YieldDistributorUpdated(distributor);
    }

    function setAssetRegistry(
        address registry
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        assetRegistry = IAssetRegistry(registry);
        emit AssetRegistryUpdated(registry);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _forcedTransfer(address from, address to, uint256 amount) internal {
        _skipSenderChecks = true;
        _transfer(from, to, amount);
        _skipSenderChecks = false;
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Pausable) {
        if (from != address(0) && !_skipSenderChecks) {
            require(whitelist[from], "RWAToken: sender not whitelisted");
            require(!frozen[from], "RWAToken: sender frozen");
        }
        if (to != address(0)) {
            require(whitelist[to], "RWAToken: receiver not whitelisted");
            require(!frozen[to], "RWAToken: receiver frozen");
        }
        if (address(yieldDistributor) != address(0)) {
            yieldDistributor.onTokenTransfer(from, to);
        }
        super._update(from, to, value);
    }
}
