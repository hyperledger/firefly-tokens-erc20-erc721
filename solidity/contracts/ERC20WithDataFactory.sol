//SPDX-License-Identifier: Unlicense
pragma solidity ^0.6.0;

import './ERC20WithData.sol';

contract ERC20WithDataFactory {
    event TokenCreate(address indexed contract_address, bytes data);

    function create(
        string memory name,
        string memory symbol,
        bytes calldata data
    ) external virtual {
        ERC20WithData dc = new ERC20WithData(name, symbol);
        emit TokenCreate(address(dc), data);
    }
}
