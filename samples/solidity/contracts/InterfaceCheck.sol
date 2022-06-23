// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import './IERC20WithData.sol';
import './IERC721WithData.sol';
import './ITokenFactory.sol';

/**
 * Test utility for checking ERC165 interface identifiers.
 */
contract InterfaceCheck {
    function tokenfactory() external view returns (bytes4) {
        return type(ITokenFactory).interfaceId;
    }

    function erc20WithData() external view returns (bytes4) {
        return type(IERC20WithData).interfaceId;
    }

    function erc721WithData() external view returns (bytes4) {
        return type(IERC721WithData).interfaceId;
    }
}
