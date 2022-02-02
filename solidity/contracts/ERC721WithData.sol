// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
    @dev Mintable+burnable form of ERC721 with data event support.
*/
contract ERC721WithData is Context, Ownable, ERC721 {
    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function mintWithData(
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external onlyOwner {
        _safeMint(to, tokenId, data);
    }

    function transferWithData(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external {
        safeTransferFrom(from, to, tokenId, data);
    }

    function burnWithData(
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external {
        require(from == _msgSender(), 'ERC20WithData: caller is not owner');
        _burn(tokenId);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return 'firefly://token/';
    }
}
