import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { deployments } from 'hardhat'
import { BasicToken } from '../types'

describe('BasicToken', async () => {
  let signers: SignerWithAddress[]
  let owner: SignerWithAddress
  let token: BasicToken

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
      owner = signers[0]
      const BasicToken = await ethers.getContractFactory('BasicToken')
      token = (await BasicToken.deploy("Basic", 'BSC', 18, 1000)) as BasicToken
    }
  )

  beforeEach(async () => {
    await setupTest()
  });

  it('Assigns initial balance', async () => {
    expect(await token.name()).to.equal("Basic");
    expect(await token.symbol()).to.equal("BSC");
    expect(await token.balanceOf(owner.address)).to.equal(1000);
  });
});
