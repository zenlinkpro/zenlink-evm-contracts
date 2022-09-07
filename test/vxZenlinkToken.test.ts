import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, constants } from 'ethers'
import { deployments } from 'hardhat'
import { VxZenlinkTokenMock, ZenlinkToken, ZenlinkTokenLoyaltyCalculator } from '../typechain-types'
import { expandTo18Decimals } from './shared/utilities'

const { MaxUint256, AddressZero } = constants
const MIN_PENALTY_RATIO = BigNumber.from(0) // 0%
const MAX_PENALTY_RATIO = expandTo18Decimals(1).div(2) // 50%

function getZenlinkTokenWithdrawFeeRatio(
  zlkTotalSupply: BigNumber,
  vxzlkShare: BigNumber
) {
  const x = vxzlkShare.mul(expandTo18Decimals(1)).div(zlkTotalSupply)
  if (x.lt(expandTo18Decimals(1).div(10))) {
    return MAX_PENALTY_RATIO
  } else if (x.gt(expandTo18Decimals(1).div(2))) {
    return MIN_PENALTY_RATIO
  } else {
    const step = (MAX_PENALTY_RATIO.sub(MIN_PENALTY_RATIO))
      .mul(expandTo18Decimals(1))
      .div(expandTo18Decimals(1).div(2).sub(expandTo18Decimals(1).div(10)))
    return MAX_PENALTY_RATIO.sub(
      x.sub(expandTo18Decimals(1).div(10)).mul(step).div(expandTo18Decimals(1))
    )
  }
}

describe('vxZenlinkToken', () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let other: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let zlk: ZenlinkToken
  let vxzlk: VxZenlinkTokenMock
  let loyaltyCalculator: ZenlinkTokenLoyaltyCalculator

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
        ;[wallet, other, user1, user2] = signers

      const zlkFactory = await ethers.getContractFactory('ZenlinkToken')
      const vxzlkFactory = await ethers.getContractFactory('vxZenlinkTokenMock')
      const loyaltyCalculatorFactory = await ethers.getContractFactory('ZenlinkTokenLoyaltyCalculator')
      zlk = (await zlkFactory.deploy('ZLK', 'Zenlink Token', 18, expandTo18Decimals(100), expandTo18Decimals(1000))) as ZenlinkToken
      vxzlk = (await vxzlkFactory.deploy(zlk.address, 'Vault vxZLK', 'vxZLK')) as VxZenlinkTokenMock
      loyaltyCalculator = (await loyaltyCalculatorFactory.deploy(vxzlk.address, zlk.address, BigNumber.from(0), expandTo18Decimals(1).div(2))) as ZenlinkTokenLoyaltyCalculator
      await vxzlk.updateLoyaltyCaculator(loyaltyCalculator.address)
      await zlk.approve(vxzlk.address, MaxUint256)
      await zlk.enableTransfer()
    }
  )

  beforeEach(async () => {
    await setupTest()
  })

  it('metadata', async () => {
    expect(await vxzlk.name()).to.be.eq('Vault vxZLK')
    expect(await vxzlk.symbol()).to.be.eq('vxZLK')
    expect(await vxzlk.decimals()).to.be.eq(18)
    expect(await vxzlk.asset()).to.be.eq(zlk.address)
    expect(await vxzlk.loyaltyCalculator()).to.be.eq(loyaltyCalculator.address)
  })

  describe('empty vault: no assets & no shares', () => {
    it('status', async () => {
      expect(await vxzlk.totalAssets()).to.be.eq(0)
    })

    it('deposit', async () => {
      expect(await vxzlk.maxDeposit(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewDeposit(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(1))
      expect(
        await vxzlk.deposit(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('mint', async () => {
      expect(await vxzlk.maxMint(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewMint(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(1))
      expect(
        await vxzlk.mint(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('withdraw', async () => {
      expect(await vxzlk.maxWithdraw(wallet.address)).to.be.eq(0)
      expect(await vxzlk.previewWithdraw('0')).to.be.eq(0)
      expect(
        await vxzlk.withdraw('0', other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, '0')
    })

    it('redeem', async () => {
      expect(await vxzlk.maxRedeem(wallet.address)).to.be.eq(0)
      expect(await vxzlk.previewRedeem('0')).to.be.eq(0)
      expect(
        await vxzlk.redeem('0', other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, '0')
    })
  })

  describe('partially empty vault: assets & no shares', () => {
    beforeEach(async () => {
      await zlk.mint(expandTo18Decimals(1))
      await zlk.transfer(vxzlk.address, expandTo18Decimals(1))
    })

    it('status', async () => {
      expect(await vxzlk.totalAssets()).to.be.eq(expandTo18Decimals(1))
    })

    it('deposit', async () => {
      expect(await vxzlk.maxDeposit(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewDeposit(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(1))
      expect(
        await vxzlk.deposit(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('mint', async () => {
      expect(await vxzlk.maxMint(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewMint(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(1))
      expect(
        await vxzlk.mint(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('withdraw', async () => {
      expect(await vxzlk.maxWithdraw(wallet.address)).to.be.eq(0)
      expect(await vxzlk.previewWithdraw('0')).to.be.eq(0)
      expect(
        await vxzlk.withdraw('0', other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, '0')
    })

    it('redeem', async () => {
      expect(await vxzlk.maxRedeem(wallet.address)).to.be.eq(0)
      expect(await vxzlk.previewRedeem('0')).to.be.eq(0)
      expect(
        await vxzlk.redeem('0', other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, '0')
    })
  })

  describe('partially empty vault: shares & no assets', () => {
    beforeEach(async () => {
      await vxzlk.mockMint(wallet.address, expandTo18Decimals(1))
    })

    it('status', async () => {
      expect(await vxzlk.totalAssets()).to.be.eq(0)
    })

    it('deposit', async () => {
      expect(await vxzlk.maxDeposit(wallet.address)).to.be.eq(0)
      expect(
        await vxzlk.deposit(0, other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, 0)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, 0)
      await expect(vxzlk.previewDeposit(expandTo18Decimals(1))).to.be.reverted
      await expect(
        vxzlk.deposit(expandTo18Decimals(1), other.address)
      ).to.be.revertedWith('ERC4626: deposit more than max')
    })

    it('mint', async () => {
      expect(await vxzlk.maxMint(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewMint(expandTo18Decimals(1))).to.be.eq(0)
      expect(
        await vxzlk.mint(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('withdraw', async () => {
      expect(await vxzlk.maxWithdraw(wallet.address)).to.be.eq(0)
      expect(await vxzlk.previewWithdraw('0')).to.be.eq(0)
      await expect(vxzlk.previewWithdraw('1')).to.be.reverted
      expect(
        await vxzlk.withdraw('0', other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, '0')
    })

    it('redeem', async () => {
      expect(await vxzlk.maxRedeem(wallet.address)).to.be.eq(expandTo18Decimals(1))
      expect(await vxzlk.previewRedeem('0')).to.be.eq(0)
      expect(
        await vxzlk.redeem(expandTo18Decimals(1), other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, '0')
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, expandTo18Decimals(1))
    })
  })

  describe('full vault: assets & shares', () => {
    beforeEach(async () => {
      await zlk.mint(expandTo18Decimals(1))
      await zlk.transfer(vxzlk.address, expandTo18Decimals(1))
      await vxzlk.mockMint(wallet.address, expandTo18Decimals(100))
    })

    it('status', async () => {
      expect(await vxzlk.totalAssets()).to.be.eq(expandTo18Decimals(1))
    })

    it('deposit', async () => {
      expect(await vxzlk.maxDeposit(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewDeposit(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(100))
      expect(
        await vxzlk.deposit(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(100))
    })

    it('mint', async () => {
      expect(await vxzlk.maxMint(wallet.address)).to.be.eq(MaxUint256)
      expect(await vxzlk.previewMint(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(1).div(100))
      expect(
        await vxzlk.mint(expandTo18Decimals(1), other.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(wallet.address, vxzlk.address, expandTo18Decimals(1).div(100))
        .to.emit(vxzlk, 'Transfer')
        .withArgs(AddressZero, other.address, expandTo18Decimals(1))
    })

    it('withdraw', async () => {
      expect(await vxzlk.maxWithdraw(wallet.address)).to.be.eq(expandTo18Decimals(1))
      expect(await vxzlk.previewWithdraw(expandTo18Decimals(1))).to.be.eq(expandTo18Decimals(100))
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = expandTo18Decimals(1).sub(
        expandTo18Decimals(1).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.withdraw(expandTo18Decimals(1), other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, expandTo18Decimals(100))
    })

    it('withdraw with approval', async function () {
      await expect(
        vxzlk.connect(other).withdraw(expandTo18Decimals(1), other.address, wallet.address)
      ).to.be.revertedWith('ERC20: insufficient allowance')
      await vxzlk.withdraw(expandTo18Decimals(1), other.address, wallet.address)
    });

    it('redeem', async () => {
      expect(await vxzlk.maxRedeem(wallet.address)).to.be.eq(expandTo18Decimals(100))
      expect(await vxzlk.previewRedeem(expandTo18Decimals(100))).to.be.eq(expandTo18Decimals(1))
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = expandTo18Decimals(1).sub(
        expandTo18Decimals(1).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.redeem(expandTo18Decimals(100), other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(wallet.address, AddressZero, expandTo18Decimals(100))
    })

    it('redeem with approval', async () => {
      await expect(
        vxzlk.connect(other).redeem(expandTo18Decimals(100), other.address, wallet.address)
      ).to.be.revertedWith('ERC20: insufficient allowance')
      await vxzlk.redeem(expandTo18Decimals(100), other.address, wallet.address)
    })
  })

  it('multiple mint, deposit, redeem & withdrawal', async () => {
    await zlk.transfer(user1.address, 4000)
    await zlk.transfer(user2.address, 7001)
    await zlk.connect(user1).approve(vxzlk.address, 4000)
    await zlk.connect(user2).approve(vxzlk.address, 7001)

    // 1. Alice mints 2000 shares (costs 2000 tokens)
    expect(
      await vxzlk.connect(user1).mint(2000, user1.address)
    )
      .to.emit(zlk, 'Transfer')
      .withArgs(user1.address, vxzlk.address, '2000')
      .to.emit(vxzlk, 'Transfer')
      .withArgs(AddressZero, user1.address, '2000')

    expect(await vxzlk.previewDeposit(2000)).to.be.eq(2000)
    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(2000)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(0)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(2000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(0)
    expect(await vxzlk.totalSupply()).to.be.eq(2000)
    expect(await vxzlk.totalAssets()).to.be.eq(2000)

    // 2. Bob deposits 4000 tokens (mints 4000 shares)
    expect(
      await vxzlk.connect(user2).mint(4000, user2.address)
    )
      .to.emit(zlk, 'Transfer')
      .withArgs(user2.address, vxzlk.address, '4000')
      .to.emit(vxzlk, 'Transfer')
      .withArgs(AddressZero, user2.address, '4000')

    expect(await vxzlk.previewDeposit(4000)).to.be.eq(4000)
    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(2000)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(4000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(2000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(4000)
    expect(await vxzlk.totalSupply()).to.be.eq(6000)
    expect(await vxzlk.totalAssets()).to.be.eq(6000)

    // 3. Vault mutates by +3000 tokens (simulated yield returned from strategy)
    await zlk.transfer(vxzlk.address, 3000)

    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(2000)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(4000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(3000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(6000)
    expect(await vxzlk.totalSupply()).to.be.eq(6000)
    expect(await vxzlk.totalAssets()).to.be.eq(9000)

    // 4. Alice deposits 2000 tokens (mints 1333 shares)
    expect(
      await vxzlk.connect(user1).deposit(2000, user1.address)
    )
      .to.emit(zlk, 'Transfer')
      .withArgs(user1.address, vxzlk.address, '2000')
      .to.emit(vxzlk, 'Transfer')
      .withArgs(AddressZero, user1.address, '1333')

    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(3333)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(4000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(4999)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(6000)
    expect(await vxzlk.totalSupply()).to.be.eq(7333)
    expect(await vxzlk.totalAssets()).to.be.eq(11000)

    // 5. Bob mints 2000 shares (costs 3001 assets)
    // NOTE: Bob's assets spent got rounded up
    // NOTE: Alices's vault assets got rounded up
    expect(
      await vxzlk.connect(user2).mint(2000, user2.address)
    )
      .to.emit(zlk, 'Transfer')
      .withArgs(user2.address, vxzlk.address, '3001')
      .to.emit(vxzlk, 'Transfer')
      .withArgs(AddressZero, user2.address, '2000')

    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(3333)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(6000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(5000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(9000)
    expect(await vxzlk.totalSupply()).to.be.eq(9333)
    expect(await vxzlk.totalAssets()).to.be.eq(14001)

    // 6. Vault mutates by +3000 tokens
    // NOTE: Vault holds 17001 tokens, but sum of assetsOf() is 17000.
    await zlk.transfer(vxzlk.address, 3000)

    expect(await vxzlk.balanceOf(user1.address)).to.be.eq(3333)
    expect(await vxzlk.balanceOf(user2.address)).to.be.eq(6000)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(6071)
    expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(10929)
    expect(await vxzlk.totalSupply()).to.be.eq(9333)
    expect(await vxzlk.totalAssets()).to.be.eq(17001)

    // 7. Alice redeem 1333 shares (2428 assets)
    {
      const assets = await vxzlk.previewRedeem(1333)
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = assets.sub(
        assets.mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.connect(user1).redeem(1333, user1.address, user1.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, user1.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(user1.address, AddressZero, '1333')

      expect(await vxzlk.balanceOf(user1.address)).to.be.eq(2000)
      expect(await vxzlk.balanceOf(user2.address)).to.be.eq(6000)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(3946)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(11840)
      expect(await vxzlk.totalSupply()).to.be.eq(8000)
      expect(await vxzlk.totalAssets()).to.be.eq(15787)
    }

    // 8. Bob withdraws 2929 assets (1485 shares)
    {
      expect(await vxzlk.previewWithdraw(2929)).to.be.eq(1485)
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = BigNumber.from(2929).sub(
        BigNumber.from(2929).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.connect(user2).withdraw(2929, user2.address, user2.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, user2.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(user2.address, AddressZero, '1485')

      expect(await vxzlk.balanceOf(user1.address)).to.be.eq(2000)
      expect(await vxzlk.balanceOf(user2.address)).to.be.eq(4515)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(4396)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(9925)
      expect(await vxzlk.totalSupply()).to.be.eq(6515)
      expect(await vxzlk.totalAssets()).to.be.eq(14322)
    }

    // 9. Alice withdraws 4396 assets (2000 shares)
    // NOTE: Bob's assets have been rounded back up
    {
      expect(await vxzlk.previewWithdraw(4396)).to.be.eq(2000)
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = BigNumber.from(4396).sub(
        BigNumber.from(4396).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.connect(user1).withdraw(4396, user1.address, user1.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, user1.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(user1.address, AddressZero, '2000')

      expect(await vxzlk.balanceOf(user1.address)).to.be.eq(0)
      expect(await vxzlk.balanceOf(user2.address)).to.be.eq(4515)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(0)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(12124)
      expect(await vxzlk.totalSupply()).to.be.eq(4515)
      expect(await vxzlk.totalAssets()).to.be.eq(12124)
    }

    // 10. Bob redeem 4515 shares (12124 tokens)
    {
      expect(await vxzlk.previewRedeem(4515)).to.be.eq(12124)
      const ratio = getZenlinkTokenWithdrawFeeRatio(
        await zlk.totalSupply(),
        await zlk.balanceOf(vxzlk.address)
      )
      const expectedZlkReceived = BigNumber.from(12124).sub(
        BigNumber.from(12124).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.connect(user2).redeem(4515, user2.address, user2.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, user2.address, expectedZlkReceived)
        .to.emit(vxzlk, 'Transfer')
        .withArgs(user2.address, AddressZero, '4515')

      expect(await vxzlk.balanceOf(user1.address)).to.be.eq(0)
      expect(await vxzlk.balanceOf(user2.address)).to.be.eq(0)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user1.address))).to.be.eq(0)
      expect(await vxzlk.convertToAssets(await vxzlk.balanceOf(user2.address))).to.be.eq(0)
      expect(await vxzlk.totalSupply()).to.be.eq(0)
      expect(await vxzlk.totalAssets()).to.be.eq(6062) // 12124 / 2 
    }
  })
})
