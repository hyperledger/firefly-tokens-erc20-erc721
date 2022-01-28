//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

// Only used to generate ERC1155MixedFungible types for use in testing
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract TestERC20WithData is ERC20 {
    constructor(string memory name, string memory symbol) public ERC20(name, symbol) {}
}
