// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
    @dev Mintable+burnable form of ERC20 with data event support.
*/
contract ERC20WithData is Context, Ownable, ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) public onlyOwner {
        _mint(to, amount);
    }

    function transferWithData(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) public {
        require(from == _msgSender(), 'ERC20WithData: caller is not owner nor approved');
        _transfer(from, to, amount);
    }

    function burnWithData(
        address from,
        uint256 amount,
        bytes calldata data
    ) public {
        require(from == _msgSender(), 'ERC20WithData: caller is not owner nor approved');
        _burn(from, amount);
    }
}
