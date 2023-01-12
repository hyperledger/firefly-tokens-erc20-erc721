// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/introspection/IERC165.sol';

/**
 * ERC721 interface with mint, burn, attached data, and custom URI support.
 *
 * The inclusion of a "data" argument on each external method allows FireFly to write
 * extra data to the chain alongside each token transaction, in order to correlate it with
 * other on- and off-chain events.
 */
interface IERC721WithData is IERC165 {
    function mintWithData(
        address to,
        bytes calldata data
    ) external;

    function mintWithURI(
        address to,
        bytes calldata data,
        string memory tokenURI_
    ) external;

    function transferWithData(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external;

    function burnWithData(
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external;

    function approveWithData(
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external;

    function setApprovalForAllWithData(
        address operator,
        bool approved,
        bytes calldata data
    ) external;

    function baseTokenUri() external returns(string memory);
}
