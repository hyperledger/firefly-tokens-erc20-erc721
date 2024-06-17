// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * Example ERC721 token with mint and burn.
 *   - Tokens are auto-indexed (starting from 1)
 *   - Only the contract owner can mint
 *   - Token URIs are set explicitly at mint time
 *   - No extra "data" argument is present on mint/burn/transfer methods, meaning that
 *     certain features of FireFly will not be available (such as tieing FireFly transactions,
 *     messages, and data to a token event)
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC721URI is ERC721, ERC721URIStorage, ERC721Burnable, Ownable {
    uint256 private _nextTokenId = 1;

    constructor(
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) Ownable(msg.sender) {}

    function safeMint(address to, string memory uri) public onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    // The following functions are overrides required by Solidity.

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
