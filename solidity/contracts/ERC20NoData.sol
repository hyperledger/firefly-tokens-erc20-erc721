// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
    @dev Basic mintable+burnable form of ERC20.
*/
contract ERC20NoData is Context, Ownable, ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mintNoData(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transferNoData(
        address from,
        address to,
        uint256 amount
    ) external {
        if (from == _msgSender()) {
            transfer(to, amount);
        } else {
            transferFrom(from, to, amount);
        }
    }

    function burnNoData(address from, uint256 amount) external {
        require(from == _msgSender(), 'ERC20NoData: caller is not owner');
        _burn(from, amount);
    }
}
