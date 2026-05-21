// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "../governance/RWARoles.sol";

contract RWAToken is ERC20Pausable, RWARoles {
    mapping(address => bool) public whitelist;
    mapping(address => bool) public frozen;

    event WhitelistUpdated(address indexed account, bool status);
    event FrozenUpdated(address indexed account, bool status);

    constructor(
        string memory name,
        string memory symbol,
        address admin
    ) ERC20(name, symbol) RWARoles(admin) {}

    function mint(address to, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _burn(from, amount);
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

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Pausable) {
        if (from != address(0)) {
            require(whitelist[from], "RWAToken: sender not whitelisted");
            require(!frozen[from], "RWAToken: sender frozen");
        }
        if (to != address(0)) {
            require(whitelist[to], "RWAToken: receiver not whitelisted");
            require(!frozen[to], "RWAToken: receiver frozen");
        }
        super._update(from, to, value);
    }
}
