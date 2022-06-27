// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/introspection/IERC165.sol';

/**
 * TokenFactory interface with data and custom URI support.
 */

interface ITokenFactory is IERC165 {
  function create(
    string memory name,
    string memory symbol,
    bool is_fungible,
    bytes calldata data,
    string memory uri
  ) external;
} 
