// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * Example ERC20 token with mint, burn, and attached data support.
 *
 * This contract demonstrates a very simple ERC20 fungible token. Notes on functionality:
 *   - the contract owner (ie deployer) is the only party allowed to mint
 *   - any party can approve another party to manage (ie transfer) a certain amount of their
 *     tokens (approving for MAX_INT gives an unlimited approval)
 *   - you may only burn your own tokens
 *   - decimals hard-coded to 18 (so 1 token is expressed as 1000000000000000000)
 *
 * The inclusion of a "data" argument on each external method allows FireFly to write
 * extra data to the chain alongside each token transaction, in order to correlate it with
 * other on- and off-chain events.
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC20WithData is Context, Ownable, ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) external onlyOwner {
        _mint(to, amount);
    }

    function transferWithData(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) external {
        if (from == _msgSender()) {
            transfer(to, amount);
        } else {
            transferFrom(from, to, amount);
        }
    }

    function burnWithData(
        address from,
        uint256 amount,
        bytes calldata data
    ) external {
        require(from == _msgSender(), 'ERC20WithData: caller is not owner');
        _burn(from, amount);
    }

    function approveWithData(
        address spender,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        return approve(spender, amount);
    }
}
