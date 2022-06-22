import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { TokenFactory } from '../typechain';

describe('TokenFactory - Unit Tests', function () {
  const contractName = 'testName';
  const contractSymbol = 'testSymbol';
  let deployedTokenFactory: TokenFactory;
  let Factory;

  let deployerSignerA: SignerWithAddress;
  let signerB: SignerWithAddress;
  let signerC: SignerWithAddress;

  beforeEach(async () => {
    [deployerSignerA, signerB, signerC] = await ethers.getSigners();
    Factory = await ethers.getContractFactory('TokenFactory');
    // Deploy token factory with Signer A
    deployedTokenFactory = await Factory.connect(deployerSignerA).deploy();
    await deployedTokenFactory.deployed();
  });

  it('Create - Should deploy a new ERC20 contract', async function () {
    const tx = await deployedTokenFactory.create(contractName, contractSymbol, true, '0x00', '');
    expect(tx).to.emit(deployedTokenFactory, 'TokenPoolCreation');
    const receipt = await tx.wait();
    const event = receipt.events?.find(e => e.event === 'TokenPoolCreation');
    expect(event).to.exist;
    if (event) {
      expect(event.args).to.have.length(5);
      expect(event.args?.[0]).to.be.properAddress;
      expect(event.args?.slice(1)).to.eql([contractName, contractSymbol, true, '0x00']);
    }
  });

  it('Create - Should deploy a new ERC721 contract', async function () {
    const tx = await deployedTokenFactory.create(contractName, contractSymbol, false, '0x00', '');
    expect(tx).to.emit(deployedTokenFactory, 'TokenPoolCreation');
    const receipt = await tx.wait();
    const event = receipt.events?.find(e => e.event === 'TokenPoolCreation');
    expect(event).to.exist;
    if (event) {
      expect(event.args).to.have.length(5);
      expect(event.args?.[0]).to.be.properAddress;
      expect(event.args?.slice(1)).to.eql([contractName, contractSymbol, false, '0x00']);
    }
  });

  it('Create - Should deploy a new ERC721 contract with a custom URI', async function () {
    const tx = await deployedTokenFactory.create(contractName, contractSymbol, false, '0x00', 'testURI');
    expect(tx).to.emit(deployedTokenFactory, 'TokenPoolCreation');
    const receipt = await tx.wait();
    const event = receipt.events?.find(e => e.event === 'TokenPoolCreation');
    expect(event).to.exist;
    if (event) {
      expect(event.args).to.have.length(5);
      expect(event.args?.[0]).to.be.properAddress;
      expect(event.args?.slice(1)).to.eql([contractName, contractSymbol, false, '0x00']);
    }
  });
});
