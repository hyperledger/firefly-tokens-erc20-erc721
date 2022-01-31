// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import '@openzeppelin/contracts/access/AccessControl.sol';

/**
    @dev Mintable+burnable form of ERC20 with data event support.
*/
contract ERC20WithData is ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(MINTER_ROLE, _msgSender());
    }

    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) public {
        require(hasRole(MINTER_ROLE, _msgSender()), 'ERC20WithData: must have minter role to mint');
        _mint(to, amount);
    }

    function transferWithData(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) public {
        _transfer(_msgSender(), to, amount);
    }

    function burnWithData(uint256 amount, bytes calldata data) public {
        _burn(_msgSender(), amount);
    }
}
