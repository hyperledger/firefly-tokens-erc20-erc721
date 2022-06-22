import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { ERC721WithData, InterfaceCheck } from '../typechain';

describe('ERC721WithData - Unit Tests', function () {
  const contractName = 'testName';
  const contractSymbol = 'testSymbol';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const ONE_ADDRESS = '0x1111111111111111111111111111111111111111';
  let deployedERC721WithData: ERC721WithData;
  let Factory;

  let deployerSignerA: SignerWithAddress;
  let signerB: SignerWithAddress;
  let signerC: SignerWithAddress;

  beforeEach(async () => {
    [deployerSignerA, signerB, signerC] = await ethers.getSigners();
    Factory = await ethers.getContractFactory('ERC721WithData');
    // Deploy erc721 token pool with Signer A
    deployedERC721WithData = await Factory.connect(deployerSignerA).deploy(
      contractName,
      contractSymbol,
      ""
    );
    await deployedERC721WithData.deployed();
  });

  it('Verify interface ID', async function () {
    const checkerFactory = await ethers.getContractFactory('InterfaceCheck');
    const checker: InterfaceCheck = await checkerFactory.connect(deployerSignerA).deploy();
    expect(await checker.erc721WithData()).to.equal('0xb2429c12');
  });

  it('Create - Should create a new ERC721 instance with default state', async function () {
    expect(await deployedERC721WithData.name()).to.equal(contractName);
    expect(await deployedERC721WithData.symbol()).to.equal(contractSymbol);
  });

  it('Mint - Should mint successfully with a custom URI', async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    // Signer A mint token 721 to Signer A (Allowed)
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithURI(deployerSignerA.address, 721, '0x00', "ipfs://CID"),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 721);

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721WithData.tokenURI(721)).to.equal('ipfs://CID');
  });

  it('Mint - Non-deployer of contract should not be able to mint tokens', async function () {
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    // Signer B mint token 721 to Signer B (Not allowed)
    await expect(
      deployedERC721WithData.connect(signerB).mintWithData(signerB.address, 721, '0x00'),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
  });

  it('Mint - Non-signing address should not be able to mint tokens', async function () {
    expect(await deployedERC721WithData.balanceOf(ONE_ADDRESS)).to.equal(0);
    // Non-signer mint token 721 to non-signer (Not allowed)
    await expect(deployedERC721WithData.connect(ONE_ADDRESS).mintWithData(ONE_ADDRESS, 721, '0x00'))
      .to.be.reverted;

    expect(await deployedERC721WithData.balanceOf(ONE_ADDRESS)).to.equal(0);
  });

  it('Transfer - Signer should transfer tokens to another signer', async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    // Signer A mint token 721 to Signer A
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithData(deployerSignerA.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 721);
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721WithData.tokenURI(721)).to.equal('firefly://token/721');
    // Signer A transfer token 721 to Signer B
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .transferWithData(deployerSignerA.address, signerB.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(deployerSignerA.address, signerB.address, 721);

    signerB.getAddress();
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(1);
  });

  it("Transfer - Approved signer should transfer tokens from approving signer's wallet", async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mint token 721 to Signer B
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 721);
    // Signer B approves signer A for token 721
    deployedERC721WithData.connect(signerB).approve(deployerSignerA.address, 721);
    // Signer A transfers token 721 from signer B to Signer C
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .transferWithData(signerB.address, signerC.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(signerB.address, signerC.address, 721);

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(1);
  });

  it("Transfer - Approved signer should not transfer unapproved token ID from approving signer's wallet", async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mint to Signer B - tokenId: 720
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 720);
    // Signer A mint to Signer B - tokenId: 721
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 721);
    // Signer B approves signer A for token 721
    deployedERC721WithData.connect(signerB).approve(deployerSignerA.address, 721);
    // Signer A transfers token 720 from signer B to Signer C (Not Allowed)
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .transferWithData(signerB.address, signerC.address, 720, '0x00'),
    ).to.be.revertedWith('ERC721: transfer caller is not owner nor approved');

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(2);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
  });

  it('Transfer - Signer should not be able to transfer from another signer if not approved', async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
    // Mint token token 720 to Signer B
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 720);
    // Mint token 721 to Signer C
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerC.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 721);
    // Signer B attempts to transfer token 721 from Signer A to Signer B (Not allowed)
    await expect(
      deployedERC721WithData
        .connect(signerB)
        .transferWithData(signerC.address, signerB.address, 721, '0x00'),
    ).to.be.reverted;
    // Signer C attempts to transfer token 720 from Signer B to Signer C (Not allowed)
    await expect(
      deployedERC721WithData
        .connect(signerC)
        .transferWithData(signerB.address, signerC.address, 720, '0x00'),
    ).to.be.reverted;

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(1);
  });

  it('Burn - Signer should burn their own tokens successfully', async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    // Mint tokens 720 and 721 to Signer A
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithData(deployerSignerA.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 720);
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithData(deployerSignerA.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 721);
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(2);
    // Signer A burns token 720
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .burnWithData(deployerSignerA.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 720);
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(1);
    // Signer A burns token 721
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .burnWithData(deployerSignerA.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 721);

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
  });

  it("Burn - Signer should not burn another signer's tokens", async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mints token 720 to itself
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithData(deployerSignerA.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 720);
    // Signer A mints token 721 to Signer B
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 721);
    // Signer A mints token 722 to Signer C
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerC.address, 722, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 722);
    // Signer B attempts to burn token 720 from Signer A wallet (not allowed)
    await expect(
      deployedERC721WithData.connect(signerB).burnWithData(deployerSignerA.address, 720, '0x00'),
    ).to.be.revertedWith('ERC721WithData: caller is not owner');
    // Signer C attempts to burn token 721 from Signer B wallet (not allowed)
    await expect(
      deployedERC721WithData.connect(signerC).burnWithData(signerB.address, 721, '0x00'),
    ).to.be.revertedWith('ERC721WithData: caller is not owner');

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(1);
  });

  it("URI - Minted token URIs should be 'firefly://token/<tokenId>'", async function () {
    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(0);
    // Signer A mints token 720 to itself
    await expect(
      deployedERC721WithData
        .connect(deployerSignerA)
        .mintWithData(deployerSignerA.address, 720, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 720);
    // Signer A mints token 721 to Signer B
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerB.address, 721, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 721);
    // Signer A mints token 722 to Signer C
    await expect(
      deployedERC721WithData.connect(deployerSignerA).mintWithData(signerC.address, 722, '0x00'),
    )
      .to.emit(deployedERC721WithData, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 722);

    expect(await deployedERC721WithData.tokenURI(720)).to.equal('firefly://token/720');
    expect(await deployedERC721WithData.tokenURI(721)).to.equal('firefly://token/721');
    expect(await deployedERC721WithData.tokenURI(722)).to.equal('firefly://token/722');

    expect(await deployedERC721WithData.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721WithData.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721WithData.balanceOf(signerC.address)).to.equal(1);
  });
});
