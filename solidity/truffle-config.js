module.exports = {
  networks: {
    development: {
      host: '127.0.0.1', // Localhost (default: none)
      port: 5100, // Standard Ethereum port (default: none)
      network_id: '*', // Any network (default: none)
    },
  },
  mocha: {
    timeout: 100000,
  },
  compilers: {
    solc: {
      version: '^0.8.0', // Fetch exact version from solc-bin (default: truffle's version)
      evmVersion: 'constantinople',
      settings: {
        optimizer: {
          enabled: true,
          runs: 1500,
        },
      },
    },
  },
};
