// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './IERC721WithData.sol';

/**
 * Example ERC721 token with mint, burn, and attached data support.
 *
 * This contract demonstrates a very simple ERC721 non-fungible token. Notes on functionality:
 *   - the contract owner (ie deployer) is the only party allowed to mint
 *   - any party can approve another party to manage (ie transfer) some or all of their tokens
 *   - any party can burn their own tokens
 *   - token URIs are hard-coded to "firefly://token/{id}"
 *
 * The inclusion of a "data" argument on each external method allows FireFly to write
 * extra data to the chain alongside each token transaction, in order to correlate it with
 * other on- and off-chain events.
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC721WithData is Context, Ownable, ERC721, IERC721WithData {
    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, IERC165) returns (bool) {
        return
            interfaceId == type(IERC721WithData).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function mintWithData(
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external override onlyOwner {
        _safeMint(to, tokenId, data);
    }

    function transferWithData(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external override {
        safeTransferFrom(from, to, tokenId, data);
    }

    function burnWithData(
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override {
        require(from == _msgSender(), 'ERC721WithData: caller is not owner');
        _burn(tokenId);
    }

    function approveWithData(
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external override {
        approve(to, tokenId);
    }

    function setApprovalForAllWithData(
        address operator,
        bool approved,
        bytes calldata data
    ) external override {
        setApprovalForAll(operator, approved);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return 'firefly://token/';
    }
}
