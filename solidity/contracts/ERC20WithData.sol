// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/utils/Context.sol';

/**
    @dev Mintable+burnable form of ERC20 with data event support.
*/
contract ERC20WithData is Context, ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) public {
        _mint(to, amount);
    }

    function transferWithData(
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
