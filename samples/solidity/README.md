# ERC20 and ERC721 Solidity Samples

## Overview

Sample Ethereum smart contracts implementing ERC20 and ERC721 tokens.

Included as a reference point for creating smart contracts that conform
to the ABIs expected by this token connector. See the Solidity source for
notes on functionality and limitations.

### TL;DR

```
npm i
npx hardhat run --network firefly scripts/deploy.ts
```

You will get - **copy out the addresses, they will not be displayed again**:

```
Generating typings for: 22 artifacts in dir: typechain for target: ethers-v5
Successfully generated 41 typings!
Compiled 22 Solidity files successfully
ERC-20 contract deployed to: 0xac80871686654d79226aa253d96B982CB25BB01D
ERC-721 contract deployed to: 0x4803Fa2baC4059A98782e209Bb18dD15A0AeE151
```

### Compile

```shell
npm run compile
```

#### Test

```shell
npm run test
```
