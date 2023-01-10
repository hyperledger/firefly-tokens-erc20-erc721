# FireFly Tokens Microservice for ERC20 & ERC721

This project provides a thin shim between [FireFly](https://github.com/hyperledger/firefly)
and ERC20/ERC721 contracts exposed via [ethconnect](https://github.com/hyperledger/firefly-ethconnect)
or [evmconnect](https://github.com/hyperledger/firefly-evmconnect).

Based on [Node.js](http://nodejs.org) and [Nest](http://nestjs.com).

This service is entirely stateless - it maps incoming REST operations directly to blockchain
calls, and maps blockchain events to outgoing websocket events.

## Smart Contracts

This connector is designed to interact with ERC20 and ERC721 smart contracts on an Ethereum
blockchain which conform to a few different patterns. The repository includes sample
[Solidity contracts](samples/solidity/) that conform to some of the ABIs expected.

At the very minimum, _all_ contracts must implement the events and methods defined in the ERC20 or
ERC721 standards, including all optional methods such as `name()` and `symbol()`, `decimals()` (for ERC20),
and `tokenURI()` (for ERC721).

Beyond this, there are a few methods for creating a contract that the connector can utilize.

### FireFly Interface Parsing

The most flexible and robust token functionality is achieved by teaching FireFly about your token
contract, then allowing it to teach the token connector. This is optional in the sense that there
are additional methods used by the token connector to guess at the contract ABI (detailed later),
but is the preferred method for most use cases.

To leverage this capability in a running FireFly environment, you must:
1. [Upload the token contract ABI to FireFly](https://hyperledger.github.io/firefly/tutorials/custom_contracts/ethereum.html)
as a contract interface.
2. Include the `interface` parameter when [creating the pool on FireFly](https://hyperledger.github.io/firefly/tutorials/tokens).

This will cause FireFly to parse the interface and provide ABI details
to this connector, so it can determine the best methods from the ABI to be used for each operation.
When this procedure is followed, the connector can find and call any variant of mint/burn/transfer/approval
that is listed in the source code for [erc20.ts](src/tokens/erc20.ts) and [erc721.ts](src/tokens/erc721.ts).
This list includes methods in the base standards, methods in the `IERC20WithData` and `IERC721WithData`
interfaces defined in this repository, and common method variants from the
[OpenZeppelin Wizard](https://wizard.openzeppelin.com). Additional variants can be added to the list
by building a custom version of this connector or by proposing them via pull request.

If implementing a new contract, the signatures in [IERC20WithData](samples/solidity/contracts/IERC20WithData.sol)
and [IERC721WithData](samples/solidity/contracts/IERC721WithData.sol) will provide the most complete
FireFly functionality by allowing FireFly transactions and messages to be pinned to the blockchain
alongside token operations. The sample [ERC20WithData](samples/solidity/contracts/ERC20WithData.sol)
and [ERC721WithData](samples/solidity/contracts/ERC721WithData.sol) contracts may be used to
get up and running with simple token support, and may provide a starting point for developing
production contracts that can be used with this connector.

### Solidity Interface Support

In the absence of being provided with ABI details, the token connector will attempt to guess the contract
ABI in use. It does this by using ERC165 `supportsInterface()` to query the contract's support for `IERC20WithData`
or `IERC721WithData`, as defined in this repository. If the query succeeds, the connector will leverage
the methods on that interface to perform token operations. Therefore it is possible to use these
contracts without the extra step of teaching FireFly about the contract interface first.

### Fallback Functionality (not recommended)

If neither of the above procedures is followed for a given contract, the connector will fall back to assuming
that the ABI looks like [ERC20NoData.json](src/abi/ERC20NoData.json) or
[ERC721NoData.json](src/abi/ERC721NoData.json), which are based on common OpenZeppelin patterns. This
behavior can also be tweaked to assume [ERC20NoDataOld.json](src/abi/ERC20NoDataOld.json) or
[ERC721NoDataOld.json](src/abi/ERC721NoDataOld.json) by setting `USE_LEGACY_ERC20_SAMPLE=true` or
`USE_LEGACY_ERC721_SAMPLE=true` in the connector environment (these sample ABIs were provided in an older version
of this repository but are now deprecated). However, relying on this fallback functionality may be unreliable
and is not recommended.

## API Extensions

The APIs of this connector conform to the FireFly fftokens standard, and are designed to be called by
FireFly. They should generally not be called directly by anything other than FireFly.

Below are some of the specific considerations and extra requirements enforced by this connector on
top of the fftokens standard.

### `/createpool`

If `config.address` is specified, the connector will index the token contract at the specified address
(must be an ERC20 contract if `type` is `fungible`, or an ERC721 contract if `type` is `nonfungible`).
`config.blockNumber` may also be supplied to begin indexing from a specific block (if it is not specified,
indexing will begin from block `0`). Any `name` provided from FireFly will be ignored by the connector.
If a `symbol` is provided from FireFly, it _must_ match the `symbol()` defined on the underlying contract.

If `config.address` is not specified, and `FACTORY_CONTRACT_ADDRESS` is set in the connector's
environment, the factory contract will be invoked to deploy a new instance of ERC20 or ERC721.
The factory contract must conform to [ITokenFactory](samples/solidity/contracts/ITokenFactory.sol) to
be usable. Any `name` and `symbol` provided from FireFly will be passed into the factory `create()`
method.

### `/mint`

For fungible (ERC20) token pools, `tokenIndex` and `uri` will be ignored.

For non-fungible (ERC721) token pools, `amount` must be 1 (or unset). If the underlying contract
expects an index to be provided, `tokenIndex` must be set (if it supports auto-indexing, `tokenIndex`
will be ignored).

### `/burn`

For non-fungible (ERC721) token pools, `tokenIndex` is required, and `amount` must be 1 (or unset).

### `/transfer`

For non-fungible (ERC721) token pools, `tokenIndex` is required, and `amount` must be 1 (or unset).

### `/approval`

For fungible (ERC20) token pools, if `config.allowance` is set, the approval will be valid for
the specified number of tokens. If omitted, the approval has unlimited allowance.

For non-fungible (ERC721) token pools, if `config.tokenIndex` is set, the approval will be for
that specific token. If omitted, the approval covers all tokens.

## Extra APIs

The following APIs are not part of the fftokens standard, but are exposed under `/api/v1`:

* `GET /receipt/:id` - Get receipt for a previous request

## Running the service

The easiest way to run this service is as part of a stack created via
[firefly-cli](https://github.com/hyperledger/firefly-cli).

To run manually, you first need to run an Ethereum blockchain node and an instance of
[firefly-ethconnect](https://github.com/hyperledger/firefly-ethconnect), and deploy the
[ERC20 smart contract](solidity/contracts/ERC20MixedFungible.sol).

Then, adjust your configuration to point at the deployed contract by editing [.env](.env)
or by setting the environment values directly in your shell.

Install and run the application using npm:

```bash
# install
$ npm install

# run in development mode
$ npm run start

# run in watch mode
$ npm run start:dev

# run in production mode
$ npm run start:prod
```

View the Swagger UI at http://localhost:3000/api<br />
View the generated OpenAPI spec at http://localhost:3000/api-json

## Manually deploy contracts

To deploy both ERC20 and ERC721 contracts to a FireFly network, use the provided `deploy` script powered by [hardhat](https://github.com/NomicFoundation/hardhat).

```bash
cd samples/solidity
npm install
npm run deploy
```

Note: [firefly-cli](https://github.com/hyperledger/firefly-cli) will take care of contract deployment during stack creation.

## Testing

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# lint
$ npm run lint

# formatting
$ npm run format
```
