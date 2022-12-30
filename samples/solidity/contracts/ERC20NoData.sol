// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * Example ERC20 token with mint and burn.
 *
 * This contract is identical to ERC20WithData, except that there is no way to record
 * extra data alongside any of the token operations. While FireFly can still index
 * the transactions and balances from this type of ABI, certain features will not be
 * available (such as tieing FireFly transactions, messages, and data to a token event).
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC20NoData is Context, Ownable, ERC20, ERC20Burnable {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
