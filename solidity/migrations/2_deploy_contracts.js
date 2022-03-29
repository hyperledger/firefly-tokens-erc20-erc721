const ERC20 = artifacts.require('./ERC20WithData.sol');

module.exports = function (deployer) {
  deployer.deploy(ERC20, 'TestToken', 'Test Token');
};
