import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { ERC721URI } from '../typechain-types';

describe('ERC721URI - Unit Tests', async function () {
  const contractName = 'testName';
  const contractSymbol = 'testSymbol';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  let deployedERC721: ERC721URI;
  let Factory;

  let deployerSignerA: SignerWithAddress;
  let signerB: SignerWithAddress;
  let signerC: SignerWithAddress;

  beforeEach(async () => {
    [deployerSignerA, signerB, signerC] = await ethers.getSigners();
    Factory = await ethers.getContractFactory('ERC721URI');
    // Deploy erc721 token pool with Signer A
    deployedERC721 = await Factory.connect(deployerSignerA).deploy(contractName, contractSymbol);
    await deployedERC721.waitForDeployment();
  });

  it('Create - Should create a new ERC721 instance with default state', async function () {
    expect(await deployedERC721.name()).to.equal(contractName);
    expect(await deployedERC721.symbol()).to.equal(contractSymbol);
  });

  it('Mint - Non-deployer cannot mint', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);

    // Signer B mint to Signer B (Not allowed)
    await expect(
      deployedERC721.connect(signerB).safeMint(signerB.address, 'ipfs://token1'),
    ).to.be.revertedWithCustomError(deployedERC721, 'OwnableUnauthorizedAccount');

    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
  });

  it('Mint - Deployer should mint tokens to itself successfully', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    // Signer A mint token to Signer A (Allowed)
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 1)
      .and.to.emit(deployedERC721, 'MetadataUpdate')
      .withArgs('1');

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721.tokenURI(1)).to.equal('ipfs://token1');
  });

  it('Mint - Non-deployer of contract should not be able to mint tokens', async function () {
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    // Signer B mint token to Signer B (Not allowed)
    await expect(
      deployedERC721.connect(signerB).safeMint(signerB.address, 'ipfs://token1'),
    ).to.be.revertedWithCustomError(deployedERC721, 'OwnableUnauthorizedAccount');

    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
  });

  it('Transfer+Burn - Signer should transfer tokens to another signer, who may then burn', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);

    // Signer A mint token to Signer A
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 1);
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721.tokenURI(1)).to.equal('ipfs://token1');

    // Signer A transfer token to Signer B
    await expect(
      deployedERC721
        .connect(deployerSignerA)
        ['safeTransferFrom(address,address,uint256)'](deployerSignerA.address, signerB.address, 1),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(deployerSignerA.address, signerB.address, 1);

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(1);

    // Signer B burn
    await expect(deployedERC721.connect(signerB).burn(1))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(signerB.address, ZERO_ADDRESS, 1);

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
  });

  it("Transfer - Approved signer should transfer tokens from approving signer's wallet", async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
    // Signer A mint token to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 1);
    // Signer B approves signer A for token
    deployedERC721.connect(signerB).approve(deployerSignerA.address, 1);
    // Signer A transfers token from signer B to Signer C
    await expect(
      deployedERC721
        .connect(deployerSignerA)
        ['safeTransferFrom(address,address,uint256)'](signerB.address, signerC.address, 1),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(signerB.address, signerC.address, 1);

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(1);
  });

  it("Transfer - Approved signer should not transfer unapproved token ID from approving signer's wallet", async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
    // Signer A mint to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 1);
    // Signer A mint to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 2);
    // Signer B approves signer A for token
    deployedERC721.connect(signerB).approve(deployerSignerA.address, 2);
    // Signer A transfers token from signer B to Signer C (Not Allowed)
    await expect(
      deployedERC721
        .connect(deployerSignerA)
        ['safeTransferFrom(address,address,uint256)'](signerB.address, signerC.address, 1),
    ).to.be.revertedWithCustomError(deployedERC721, 'ERC721InsufficientApproval');

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(2);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
  });

  it('Transfer - Signer should not be able to transfer from another signer if not approved', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
    // Mint token token to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 1);
    // Mint token to Signer C
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerC.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 2);
    // Signer B attempts to transfer token from Signer C to Signer B (Not allowed)
    await expect(
      deployedERC721
        .connect(signerB)
        ['safeTransferFrom(address,address,uint256)'](signerC.address, signerB.address, 1),
    ).to.be.reverted;
    // Signer C attempts to transfer token from Signer B to Signer C (Not allowed)
    await expect(
      deployedERC721
        .connect(signerC)
        ['safeTransferFrom(address,address,uint256)'](signerB.address, signerC.address, 2),
    ).to.be.reverted;

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(1);
  });

  it('Burn - Signer should burn their own tokens successfully', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    // Mint tokens to Signer A
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 1);
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 2);
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(2);
    // Signer A burns token
    await expect(deployedERC721.connect(deployerSignerA).burn(1))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 1);
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(1);
    // Signer A burns token
    await expect(deployedERC721.connect(deployerSignerA).burn(2))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(deployerSignerA.address, ZERO_ADDRESS, 2);

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
  });

  it("Burn - Signer should not burn another signer's tokens", async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
    // Signer A mints token to itself
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 1);
    // Signer A mints token to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 2);
    // Signer A mints token to Signer C
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerC.address, 'ipfs://token1'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 3);
    // Signer B attempts to burn token from Signer A wallet (not allowed)
    await expect(deployedERC721.connect(signerB).burn(1)).to.be.revertedWithCustomError(
      deployedERC721,
      'ERC721InsufficientApproval',
    );
    // Signer C attempts to burn token from Signer B wallet (not allowed)
    await expect(deployedERC721.connect(signerC).burn(2)).to.be.revertedWithCustomError(
      deployedERC721,
      'ERC721InsufficientApproval',
    );

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(1);
  });

  it('URI - Minted token URIs should be set', async function () {
    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(0);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(0);
    // Signer A mints token to itself
    await expect(
      deployedERC721.connect(deployerSignerA).safeMint(deployerSignerA.address, 'ipfs://token1'),
    )
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, deployerSignerA.address, 1);
    // Signer A mints token to Signer B
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerB.address, 'ipfs://token2'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerB.address, 2);
    // Signer A mints token to Signer C
    await expect(deployedERC721.connect(deployerSignerA).safeMint(signerC.address, 'ipfs://token3'))
      .to.emit(deployedERC721, 'Transfer')
      .withArgs(ZERO_ADDRESS, signerC.address, 3);

    expect(await deployedERC721.tokenURI(1)).to.equal('ipfs://token1');
    expect(await deployedERC721.tokenURI(2)).to.equal('ipfs://token2');
    expect(await deployedERC721.tokenURI(3)).to.equal('ipfs://token3');

    expect(await deployedERC721.balanceOf(deployerSignerA.address)).to.equal(1);
    expect(await deployedERC721.balanceOf(signerB.address)).to.equal(1);
    expect(await deployedERC721.balanceOf(signerC.address)).to.equal(1);
  });
});
