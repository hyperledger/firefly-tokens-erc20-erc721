//SPDX-License-Identifier: Unlicense
pragma solidity ^0.6.0;

import './ERC20WithData.sol';

contract ERC20WithDataFactory {
  event ContractDeploy(address indexed contract_address, bytes indexed data);

  function deployContract(string memory name, string memory symbol, bytes calldata data) external {
    ERC20WithData dc = new ERC20WithData(name, symbol);

    emit ContractDeploy(address(dc), data);
  }
}