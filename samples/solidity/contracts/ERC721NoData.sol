// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Counters.sol';

/**
 * Example ERC721 token with mint and burn.
 *
 * This contract is identical to ERC721WithData, except that there is no way to record
 * extra data alongside any of the token operations. While FireFly can still index
 * the transactions and balances from this type of ABI, certain features will not be
 * available (such as tieing FireFly transactions, messages, and data to a token event).
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC721NoData is Context, Ownable, ERC721, ERC721Burnable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;

    constructor(string memory name, string memory symbol) ERC721(name, symbol) {
        // Start counting at 1
        _tokenIdCounter.increment();
    }

    function safeMint(address to) public onlyOwner {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(to, tokenId);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return 'firefly://token/';
    }
}
