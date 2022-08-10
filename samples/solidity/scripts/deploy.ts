// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat';

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const ERC20 = await ethers.getContractFactory('ERC20WithData');
  const erc20 = await ERC20.deploy('FFC', 'FFC');
  await erc20.deployed();
  console.log('ERC-20 contract deployed to:', erc20.address);

  const ERC721 = await ethers.getContractFactory('ERC721WithData');
  const erc721 = await ERC721.deploy('FFNFT', 'FFNFT', "");
  await erc721.deployed();
  console.log('ERC-721 contract deployed to:', erc721.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
