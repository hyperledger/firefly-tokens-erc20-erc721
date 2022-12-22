import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { ERC20NoData } from '../typechain';

describe('ERC20NoData - Unit Tests', function () {
  const contractName = 'testName';
  const contractSymbol = 'testSymbol';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const ONE_ADDRESS = '0x1111111111111111111111111111111111111111';
  let deployedERC20NoData: ERC20NoData;
  let Factory;

  let deployerSignerA: SignerWithAddress;
  let signerB: SignerWithAddress;
  let signerC: SignerWithAddress;

  beforeEach(async () => {
    [deployerSignerA, signerB, signerC] = await ethers.getSigners();
    Factory = await ethers.getContractFactory('ERC20NoData');
    // Deploy erc20 token pool with Signer A
    deployedERC20NoData = await Factory.connect(deployerSignerA).deploy(
      contractName,
      contractSymbol,
    );
    await deployedERC20NoData.deployed();
  });

  it('Create - Should create a new ERC20 instance with default state', async function () {
    expect(await deployedERC20NoData.name()).to.equal(contractName);
    expect(await deployedERC20NoData.symbol()).to.equal(contractSymbol);
  });

  it('Mint - Deployer should mint tokens to itself successfully', async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    // Signer A mint to Signer A (Allowed)
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(deployerSignerA.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 20);

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(20);
  });

  it('Mint - Non-deployer of contract should not be able to mint tokens', async function () {
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
    // Signer B mint to Signer B (Not allowed)
    await expect(deployedERC20NoData.connect(signerB).mint(signerB.address, 20)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
  });

  it('Mint - Non-signing address should not be able to mint tokens', async function () {
    expect(await deployedERC20NoData.balanceOf(ONE_ADDRESS)).to.equal(0);
    // Non-signer mint to non-signer (Not allowed)
    await expect(deployedERC20NoData.connect(ONE_ADDRESS).mint(ONE_ADDRESS, 20)).to.be.reverted;

    expect(await deployedERC20NoData.balanceOf(ONE_ADDRESS)).to.equal(0);
  });

  it('Transfer - Signer should transfer tokens to another signer', async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
    // Signer A mint to Signer A
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(deployerSignerA.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 20);
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(20);
    // Signer A transfer to Signer B
    await expect(deployedERC20NoData.connect(deployerSignerA).transfer(signerB.address, 10))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(deployerSignerA.address, signerB.address, 10);

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(10);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(10);
  });

  it("Transfer - Approved signer should transfer tokens from approving signer's wallet", async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mint to Signer B
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(signerB.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 20);

    // Signer B approves signer A
    deployedERC20NoData.connect(signerB).approve(deployerSignerA.address, 10);
    // Signer A transfers from signer B to Signer C
    await expect(
      deployedERC20NoData
        .connect(deployerSignerA)
        .transferFrom(signerB.address, signerC.address, 10),
    )
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(signerB.address, signerC.address, 10);

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(10);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(10);
  });

  it('Transfer - Signer should not be able to transfer from another signer if not approved', async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(0);

    // Mint tokens to Signer B
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(signerB.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 20);
    // Mint tokens to Signer C
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(signerC.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 20);
    // Signer B attempts to transfer from Signer A to Signer B (Not allowed)
    await expect(
      deployedERC20NoData
        .connect(signerB)
        .transferFrom(deployerSignerA.address, signerB.address, 10),
    ).to.be.reverted;
    // Signer C attempts to transfer from Signer B to Signer C (Not allowed)
    await expect(
      deployedERC20NoData.connect(signerC).transferFrom(signerB.address, signerC.address, 10),
    ).to.be.reverted;

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(20);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(20);
  });

  it('Burn - Signer should burn their own tokens successfully', async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    // Mint tokens to Signer A
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(deployerSignerA.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 20);
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(20);

    // Signer A burns 5 of their tokens
    await expect(deployedERC20NoData.connect(deployerSignerA).burn(deployerSignerA.address, 5))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 5);

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(15);
    // Signer A burns 15 of their tokens
    await expect(deployedERC20NoData.connect(deployerSignerA).burn(deployerSignerA.address, 15))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 15);

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
  });

  it("Burn - Signer should not burn another signer's tokens", async function () {
    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mints 20 tokens to itself
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(deployerSignerA.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 20);
    // Signer A mints 20 tokens to Signer B
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(signerB.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 20);
    // Signer A mints 20 tokens to Signer C
    await expect(deployedERC20NoData.connect(deployerSignerA).mint(signerC.address, 20))
      .to.emit(deployedERC20NoData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 20);
    // Signer B attempts to burn tokens from Signer A wallet (not allowed)
    await expect(
      deployedERC20NoData.connect(signerB).burn(deployerSignerA.address, 10),
    ).to.be.revertedWith('ERC20NoData: caller is not owner');
    // Signer A attempts to burn tokens from Signer B wallet (not allowed)
    await expect(
      deployedERC20NoData.connect(deployerSignerA).burn(signerB.address, 10),
    ).to.be.revertedWith('ERC20NoData: caller is not owner');

    expect(await deployedERC20NoData.balanceOf(deployerSignerA.address)).to.equal(20);
    expect(await deployedERC20NoData.balanceOf(signerB.address)).to.equal(20);
    expect(await deployedERC20NoData.balanceOf(signerC.address)).to.equal(20);
  });
});
