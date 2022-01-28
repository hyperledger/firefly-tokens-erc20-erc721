//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import './ERC20WithData.sol';

contract ERC20WithDataFactory is Context {
    event TokenCreate(
        address indexed operator,
        address indexed contract_address,
        string name,
        string symbol,
        bytes data
    );

    function create(
        string memory name,
        string memory symbol,
        bytes calldata data
    ) external virtual {
        ERC20WithData dc = new ERC20WithData(name, symbol);
        emit TokenCreate(_msgSender(), address(dc), name, symbol, data);
    }
}
