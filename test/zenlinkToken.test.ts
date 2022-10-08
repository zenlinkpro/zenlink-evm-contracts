import { expect } from "chai";
import { constants } from "ethers";
import { expandTo18Decimals } from './shared/utilities'
import { Address } from "ethereumjs-util";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments } from "hardhat";
import { ZenlinkToken } from "../types";

describe('ZenlinkToken', () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let walletTo: SignerWithAddress

  let zenlinkToken: ZenlinkToken

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
        ;[wallet, walletTo] = signers

      const zlkFactory = await ethers.getContractFactory('ZenlinkToken')
      zenlinkToken = (await zlkFactory.deploy("ZLK", "zenlink token", 18, '30000000000000000000000000', '40000000000000000000000000')) as ZenlinkToken
      await zenlinkToken.transfer(walletTo.address, expandTo18Decimals(2))
    }
  )

  beforeEach(async () => {
    await setupTest()
  })

  it("mint", async () => {
    await expect(zenlinkToken.connect(walletTo).mint(expandTo18Decimals(1))).to.be.revertedWith('not admin')

    await expect(zenlinkToken.connect(wallet).mint(expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(constants.AddressZero, wallet.address, expandTo18Decimals(1))

    await expect(zenlinkToken.connect(wallet).mint('40000000000000000000000000'))
      .to.revertedWith("can't mint")
  })

  it("transfer only admin", async () => {
    await expect(zenlinkToken.transfer(walletTo.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))

    await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)
  })

  it('transferFrom only admin', async () => {
    await zenlinkToken.connect(walletTo).approve(wallet.address, expandTo18Decimals(1));
    await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1));

    await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)

    await expect(zenlinkToken.transferFrom(walletTo.address, wallet.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))
  })

  it('whitelist', async () => {
    await expect(zenlinkToken.connect(walletTo).addWhitelist(walletTo.address)).to.be.revertedWith('not admin')
    await zenlinkToken.addWhitelist(walletTo.address)

    await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))


    await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1))
    await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))

    await expect(zenlinkToken.connect(walletTo).removeWhitelist(walletTo.address)).to.be.revertedWith('not admin')
    await zenlinkToken.removeWhitelist(walletTo.address)

    await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)
    await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)
  })

  it('global transferable switch', async () => {
    await expect(zenlinkToken.connect(walletTo).enableTransfer()).to.be.revertedWith('not admin')
    await zenlinkToken.enableTransfer()
    await expect(zenlinkToken.connect(walletTo).disableTransfer()).to.be.revertedWith('not admin')

    await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))


    await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1))
    await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1)))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))


    await zenlinkToken.disableTransfer()

    await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)
    await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1)))
      .to.be.revertedWith(`can't transfer`)
  })

  it('burn', async () => {
    await zenlinkToken.enableTransfer()

    let totalSupplyBeforeBurn = await zenlinkToken.totalSupply();

    await expect(zenlinkToken.burn("15000000000000000000000000"))
      .to.emit(zenlinkToken, "Transfer")
      .withArgs(wallet.address, Address.zero().toString(), "15000000000000000000000000");

    let totalSupplyAfterBurn = await zenlinkToken.totalSupply();
    let balanceAfterBurn = await zenlinkToken.balanceOf(wallet.address);

    expect(totalSupplyBeforeBurn.sub(totalSupplyAfterBurn)).to.be.equals('15000000000000000000000000');
    expect(balanceAfterBurn).to.be.equal("14999998000000000000000000");
  })
})
