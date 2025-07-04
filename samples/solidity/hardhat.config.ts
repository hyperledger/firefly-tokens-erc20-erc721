import * as dotenv from 'dotenv';

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      evmVersion: 'paris',
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  defaultNetwork: 'firefly',
  networks: {
    firefly: {
      url: 'http://127.0.0.1:5100',
    },
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
