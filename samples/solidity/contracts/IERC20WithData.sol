// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/introspection/IERC165.sol';

/**
 * ERC20 interface with mint, burn, and attached data support.
 *
 * The inclusion of a "data" argument on each external method allows FireFly to write
 * extra data to the chain alongside each token transaction, in order to correlate it with
 * other on- and off-chain events.
 */
interface IERC20WithData is IERC165 {
    function mintWithData(
        address to,
        uint256 amount,
        bytes calldata data
    ) external;

    function transferWithData(
        address from,
        address to,
        uint256 amount,
        bytes calldata data
    ) external;

    function burnWithData(
        address from,
        uint256 amount,
        bytes calldata data
    ) external;

    function approveWithData(
        address spender,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);
}
