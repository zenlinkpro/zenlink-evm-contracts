import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, constants, Contract } from 'ethers'
import { expandTo18Decimals } from './shared/utilities'

import ZenlinkToken from '../build/contracts/tokens/ZenlinkToken.sol/ZenlinkToken.json'
import vxZenlinkToken from '../build/contracts/tokens/vxZenlinkToken.sol/vxZenlinkToken.json'
import ZenlinkTokenLoyaltyCalculator from '../build/contracts/libraries/ZenlinkTokenLoyaltyCalculator.sol/ZenlinkTokenLoyaltyCalculator.json'

chai.use(solidity)

const { MaxUint256, AddressZero } = constants

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
  const [wallet, other] = provider.getWallets()

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

  describe('empty vault: no assets & no shares', async () => {
    it('status', async () => {
      expect(await vxzlk.totalAssets()).to.be.eq(0)
    });

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
})
