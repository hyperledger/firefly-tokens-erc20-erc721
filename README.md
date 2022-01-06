# FireFly Tokens Microservice for ERC20

This project provides a thin shim between [FireFly](https://github.com/hyperledger/firefly)
and an ERC20 contract exposed via [ethconnect](https://github.com/hyperledger/firefly-ethconnect).

Based on [Node.js](http://nodejs.org) and [Nest](http://nestjs.com).

This service is entirely stateless - it maps incoming REST operations directly to ethconnect
calls, and maps ethconnect events to outgoing websocket events.

## POST APIs

The following POST APIs are exposed under `/api/v1`:

* `POST /createpool` - Create a new token pool (inputs: type, data)
* `POST /activatepool` - Activate a token pool to begin receiving transfers (inputs: poolId)
* `POST /mint` - Mint new tokens (inputs: poolId, to, amount, data)
* `POST /burn` - Burn tokens (inputs: poolId, tokenIndex, from, amount, data)
* `POST /transfer` - Transfer tokens (inputs: poolId, tokenIndex, from, to, amount, data)

All requests may be optionally accompanied by a `requestId`, which must be unique for every
request and will be returned in the "receipt" websocket event.

All APIs are async and return 202 immediately with a response of the form `{id: string}`.
If no `requestId` was provided, this will be a randomly assigned ID. Clients should
subscribe to the websocket (see below) in order to receive feedback when the async
operation completes.

## Websocket events

Websocket notifications can be received by connecting to `/api/ws`.
All events have the form `{event: string, id: string, data: any}`.

When any POST operation completes, it will trigger a websocket event of the form:
`{event: "receipt", data: {id: string, success: bool, message?: string}}`.
This event is sent to all connected websocket clients and is informative only (does
not require any acknowledgment).

Successful POST operations will also result in a detailed event corresponding to the type of
transaction that was performed. The events and corresponding data items are:

* `token-pool` - Token pool created (outputs: poolId, operator, type, data)
* `token-mint` - Tokens minted (outputs: id, poolId, tokenIndex, uri, operator, to, amount, data)
* `token-burn` - Tokens burned (outputs: id, poolId, tokenIndex, uri, operator, from, amount, data)
* `token-transfer` - Tokens transferred (outputs: id, poolId, tokenIndex, uri, operator, from, to, amount, data)

If multiple websocket clients are connected, only one will receive these events.
Each one of these _must_ be acknowledged by replying on the websocket with `{event: "ack", data: {id}}`.

## GET APIs

The following GET APIs are exposed under `/api/v1`:

* `GET /balance` - Get token balance (inputs: poolId, tokenIndex, account)
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
