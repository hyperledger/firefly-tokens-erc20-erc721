// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Context.sol';
import '@openzeppelin/contracts/utils/Strings.sol';
import '@openzeppelin/contracts/utils/Counters.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import './IERC721WithData.sol';

/**
 * Example ERC721 token with mint, burn, and attached data support.
 *
 * This contract demonstrates a very simple ERC721 non-fungible token. Notes on functionality:
 *   - the contract owner (ie deployer) is the only party allowed to mint
 *   - any party can approve another party to manage (ie transfer) some or all of their tokens
 *   - any party can burn their own tokens
 *   - token URIs are customizable when minting, but default to "firefly://token/{id}"
 *
 * The inclusion of a "data" argument on each external method allows FireFly to write
 * extra data to the chain alongside each token transaction, in order to correlate it with
 * other on- and off-chain events.
 *
 * This is a sample only and NOT a reference implementation.
 */
contract ERC721WithData is Context, Ownable, ERC721, IERC721WithData {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;
    string private _baseTokenURI;

    // Optional mapping for token URIs
    mapping(uint256 => string) private _tokenURIs;

    constructor(
        string memory name,
        string memory symbol,
        string memory baseTokenURI
    ) ERC721(name, symbol) {
        _baseTokenURI = baseTokenURI;
        // Start counting at 1
        _tokenIdCounter.increment();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC721WithData).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function mintWithData(address to, bytes calldata data) external override onlyOwner {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(to, tokenId, data);
        _setTokenURI(tokenId, string(abi.encodePacked(_baseURI(), Strings.toString(tokenId))));
    }

    function mintWithURI(
        address to,
        bytes calldata data,
        string memory tokenURI_
    ) external override onlyOwner {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(to, tokenId, data);

        // If there is no tokenURI passed, concatenate the tokenID to the base URI
        bytes memory tempURITest = bytes(tokenURI_);
        if (tempURITest.length == 0) {
            _setTokenURI(tokenId, string(abi.encodePacked(_baseURI(), Strings.toString(tokenId))));
        } else {
            _setTokenURI(tokenId, tokenURI_);
        }
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
        bytes memory tempURITest = bytes(_baseTokenURI);
        if (tempURITest.length == 0) {
            return 'firefly://token/';
        } else {
            return _baseTokenURI;
        }
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), 'ERC721WithData: Token does not exist');

        string memory uri = _tokenURIs[tokenId];
        return uri;
    }

    function _setTokenURI(uint256 tokenId, string memory _tokenURI) internal onlyOwner {
        require(_exists(tokenId), 'ERC721WithData: Token does not exist');
        _tokenURIs[tokenId] = _tokenURI;
    }

    function baseTokenUri() public view virtual override returns (string memory) {
        return _baseURI();
    }
}
