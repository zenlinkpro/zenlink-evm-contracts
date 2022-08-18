import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, constants, Contract } from 'ethers'
import { expandTo18Decimals } from './shared/utilities'

import ZenlinkToken from '../build/contracts/tokens/ZenlinkToken.sol/ZenlinkToken.json'
import vxZenlinkToken from '../build/contracts/test/vxZenlinkTokenMock.sol/vxZenlinkTokenMock.json'
import ZenlinkTokenLoyaltyCalculator from '../build/contracts/libraries/ZenlinkTokenLoyaltyCalculator.sol/ZenlinkTokenLoyaltyCalculator.json'

chai.use(solidity)

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
  let zlk: Contract
  let vxzlk: Contract
  let loyaltyCalculator: Contract

  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other, user1, user2] = provider.getWallets()

  beforeEach(async () => {
    zlk = await deployContract(
      wallet, 
      ZenlinkToken, 
      ['ZLK', 'Zenlink Token', 18, expandTo18Decimals(100), expandTo18Decimals(1000)]
    )
    vxzlk = await deployContract(
      wallet, 
      vxZenlinkToken, 
      [zlk.address, 'Vault vxZLK', 'vxZLK']
    )
    loyaltyCalculator = await deployContract(
      wallet,
      ZenlinkTokenLoyaltyCalculator,
      [vxzlk.address, zlk.address, BigNumber.from(0), expandTo18Decimals(1).div(2)]
    )
    await vxzlk.updateLoyaltyCaculator(loyaltyCalculator.address)
    await zlk.approve(vxzlk.address, MaxUint256)
    await zlk.enableTransfer()
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
      const zlkAmountExpectedReceived = expandTo18Decimals(1).sub(
        expandTo18Decimals(1).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.withdraw(expandTo18Decimals(1), other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, zlkAmountExpectedReceived)
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
      const zlkAmountExpectedReceived = expandTo18Decimals(1).sub(
        expandTo18Decimals(1).mul(ratio).div(expandTo18Decimals(1))
      )
      expect(
        await vxzlk.redeem(expandTo18Decimals(100), other.address, wallet.address)
      )
        .to.emit(zlk, 'Transfer')
        .withArgs(vxzlk.address, other.address, zlkAmountExpectedReceived)
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
    {
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
    }
  })
})
