//SPDX-License-Identifier: Unlicense

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/Context.sol';
import './ERC20WithData.sol';
import './ERC721WithData.sol';

contract TokenFactory is Context {
    event TokenCreate(address indexed contract_address, string name, string symbol, bool is_fungible, bytes data);

    function create(
        string memory name,
        string memory symbol,
        bool is_fungible,
        bytes calldata data
    ) external virtual {
        if (is_fungible) {
            ERC20WithData erc20 = new ERC20WithData(name, symbol);
            erc20.transferOwnership(_msgSender());
            emit TokenCreate(address(erc20), name, symbol, true, data);
        } else {
            ERC721WithData erc721 = new ERC721WithData(name, symbol);
            erc721.transferOwnership(_msgSender());
            emit TokenCreate(address(erc721), name, symbol, false, data);
        }
    }
}
