//SPDX-License-Identifier: Unlicense

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/Context.sol';
import './ERC20WithData.sol';
import './ERC721WithData.sol';
import './ITokenFactory.sol';

/**
 * Example TokenFactory for deploying simple ERC20 and ERC721 token contracts.
 *
 * This contract demonstrates a factory pattern for token creation, which has some benefits when used with FireFly:
 *   - the blockchain overhead (including gas, etc) is lessened when creating many tokens, as the factory contract
 *     only has to be deployed to the chain once
 *   - allows FireFly to instantiate new tokens via simple API calls
 *
 * This is a sample only and NOT a reference implementation.
 *
 * NOTE: This contract includes both ERC-20 and ERC-721, making the compiled contract very large. This could have
 * significant gas / cost implications which is something to be aware of if you deploy this contract.
 *
 * Just a few of the questions to consider when developing a contract for production:
 *   - is a factory pattern the best solution for your use case, or is a pre-deployed token contract more suitable?
 *   - is a proxy layer needed for contract upgradeability?
 *   - are other extension points beyond "name", "symbol", and "uri" needed (for instance "decimals" or "supply")?
 *
 * See the FireFly documentation for descriptions of the various patterns supported for working with tokens.
 * Please also read the descriptions of the sample ERC20WithData and ERC721WithData contracts utilized by this
 * factory, as they have other important considerations noted specific to each token type.
 *
 * Finally, remember to always consult best practices from other communities and examples (such as OpenZeppelin)
 * when crafting your token logic, rather than relying on the FireFly community alone. Happy minting!
 */
contract TokenFactory is Context, ITokenFactory {
    event TokenPoolCreation(
        address indexed contract_address,
        string name,
        string symbol,
        bool is_fungible,
        bytes data
    );

    function create(
        string memory name,
        string memory symbol,
        bool is_fungible,
        bytes calldata data,
        string memory uri
    ) external virtual override {
        if (is_fungible) {
            ERC20WithData erc20 = new ERC20WithData(name, symbol);
            erc20.transferOwnership(_msgSender());
            emit TokenPoolCreation(address(erc20), name, symbol, true, data);
        } else {
            ERC721WithData erc721 = new ERC721WithData(name, symbol, uri);
            erc721.transferOwnership(_msgSender());
            emit TokenPoolCreation(address(erc721), name, symbol, false, data);
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(IERC165) returns (bool) {
        return interfaceId == type(ITokenFactory).interfaceId;
    }
}
