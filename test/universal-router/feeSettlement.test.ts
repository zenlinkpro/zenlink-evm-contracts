import { setBalance } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { constants } from "ethers"
import { keccak256 } from "ethers/lib/utils"
import { deployments } from "hardhat"
import { BasicToken, FeeSettlement, ReferralStorage, WETH } from "../../types"

const { } = constants
const NativeAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

describe("FeeSettlement", () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let user0: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let feeTo: SignerWithAddress
  let feeSettlement: FeeSettlement
  let referralStorage: ReferralStorage
  let weth: WETH
  let token0: BasicToken

  const setupTest = deployments.createFixture(async ({ deployments, ethers }) => {
    await deployments.fixture()
    signers = await ethers.getSigners()
      ;[wallet, user0, user1, user2, feeTo] = signers
    const wethFactory = await ethers.getContractFactory('WETH')
    const referralStorageFactory = await ethers.getContractFactory('ReferralStorage')
    const feeSettlementFactory = await ethers.getContractFactory('FeeSettlement')
    weth = (await wethFactory.deploy()) as WETH
    referralStorage = (await referralStorageFactory.deploy()) as ReferralStorage
    feeSettlement = (await feeSettlementFactory.deploy(
      weth.address,
      referralStorage.address,
      0,
      0,
      0,
      feeTo.address
    )) as FeeSettlement
    const basicTokenFactory = await ethers.getContractFactory('BasicToken')
    token0 = (await basicTokenFactory.deploy('Token0', 'Token0', '18', '0')) as BasicToken
  })

  beforeEach(async () => {
    await setupTest()
  })

  it('setFeeShare', async () => {
    await expect(feeSettlement.setFeeShare(31))
      .to.be.revertedWithCustomError(feeSettlement, 'InvalidFeeShare')
    await feeSettlement.setFeeShare(10)
    expect(await feeSettlement.feeShare()).to.eq(10)
  })

  it('setFeeDiscount', async () => {
    await expect(feeSettlement.setFeeDiscount(10001))
      .to.be.revertedWithCustomError(feeSettlement, 'InvalidFeeDiscount')
    await feeSettlement.setFeeDiscount(2000)
    expect(await feeSettlement.feeDiscount()).to.eq(2000)
  })

  it('setFeeRebate', async () => {
    await expect(feeSettlement.setFeeRebate(10001))
      .to.be.revertedWithCustomError(feeSettlement, 'InvalidFeeRebate')
    await feeSettlement.setFeeRebate(2500)
    expect(await feeSettlement.feeRebate()).to.eq(2500)
  })

  describe('0 fee share, 0 fee discount, 0 fee rebate', () => {
    it('ERC20 settlement', async () => {
      await token0.setBalance(feeSettlement.address, 1000)
      await expect(feeSettlement.processSettlement(token0.address, 1100, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      await feeSettlement.processSettlement(token0.address, 1000, wallet.address, wallet.address)
      expect(await token0.balanceOf(wallet.address)).to.eq(1000)
    })

    it('ETH settlement', async () => {
      await setBalance(feeSettlement.address, 1000)
      await expect(feeSettlement.processSettlement(NativeAddress, 1100, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      const prevBalance = await user0.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 1000, wallet.address, user0.address)
      expect(await user0.getBalance()).to.eq(prevBalance.add(1000))
    })
  })

  describe('0.1% fee share, 0 fee discount, 0 fee rebate', () => {
    beforeEach(async () => {
      await feeSettlement.setFeeShare(10)
    })

    it('ERC20 settlement', async () => {
      await token0.setBalance(feeSettlement.address, 1000)
      await expect(feeSettlement.processSettlement(token0.address, 1100, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      await feeSettlement.processSettlement(token0.address, 1000, wallet.address, wallet.address)
      expect(await token0.balanceOf(wallet.address)).to.eq(1000)
      expect(await token0.balanceOf(feeTo.address)).to.eq(0)

      await token0.setBalance(feeSettlement.address, 1000)
      await feeSettlement.processSettlement(token0.address, 950, wallet.address, user0.address)
      expect(await token0.balanceOf(user0.address)).to.eq(999)
      expect(await token0.balanceOf(feeTo.address)).to.eq(1)
    })

    it('ETH settlement', async () => {
      await setBalance(feeSettlement.address, 1000)
      await expect(feeSettlement.processSettlement(NativeAddress, 1100, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      const prevBalance0 = await user0.getBalance()
      const prevFeeTo0 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 1000, wallet.address, user0.address)
      expect(await user0.getBalance()).to.eq(prevBalance0.add(1000))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo0.add(0))

      await setBalance(feeSettlement.address, 1000)
      const prevBalance1 = await user1.getBalance()
      const prevFeeTo1 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 950, wallet.address, user1.address)
      expect(await user1.getBalance()).to.eq(prevBalance1.add(999))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo1.add(1))
    })
  })

  describe('0.1% fee share, 20% fee discount, 0 fee rebate, without referrer', () => {
    beforeEach(async () => {
      await feeSettlement.setFeeShare(10)
      await feeSettlement.setFeeDiscount(2000)
    })

    it('ERC20 settlement', async () => {
      await token0.setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(token0.address, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      await feeSettlement.processSettlement(token0.address, 10000, wallet.address, wallet.address)
      expect(await token0.balanceOf(wallet.address)).to.eq(10000)
      expect(await token0.balanceOf(feeTo.address)).to.eq(0)

      await token0.setBalance(feeSettlement.address, 10000)
      await feeSettlement.processSettlement(token0.address, 9500, wallet.address, user0.address)
      expect(await token0.balanceOf(user0.address)).to.eq(9990)
      expect(await token0.balanceOf(feeTo.address)).to.eq(10)
    })

    it('ETH settlement', async () => {
      await setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(NativeAddress, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      const prevBalance0 = await user0.getBalance()
      const prevFeeTo0 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 10000, wallet.address, user0.address)
      expect(await user0.getBalance()).to.eq(prevBalance0.add(10000))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo0.add(0))

      await setBalance(feeSettlement.address, 10000)
      const prevBalance1 = await user1.getBalance()
      const prevFeeTo1 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 9500, wallet.address, user1.address)
      expect(await user1.getBalance()).to.eq(prevBalance1.add(9990))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo1.add(10))
    })
  })

  describe('0.1% fee share, 20% fee discount, 0 fee rebate, with referrer', () => {
    beforeEach(async () => {
      await feeSettlement.setFeeShare(10)
      await feeSettlement.setFeeDiscount(2000)
      const code = keccak256("0xFF")
      await referralStorage.connect(user2).registerCode(code)
      await referralStorage.setReferralCodeByUser(code)
    })

    it('ERC20 settlement', async () => {
      await token0.setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(token0.address, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      await feeSettlement.processSettlement(token0.address, 10000, wallet.address, wallet.address)
      expect(await token0.balanceOf(wallet.address)).to.eq(10000)
      expect(await token0.balanceOf(feeTo.address)).to.eq(0)

      await token0.setBalance(feeSettlement.address, 10000)
      expect(await feeSettlement.processSettlement(token0.address, 9500, wallet.address, user0.address))
        .to.emit(feeSettlement, 'PayRebates')
      expect(await token0.balanceOf(user0.address)).to.eq(9992)
      expect(await token0.balanceOf(feeTo.address)).to.eq(8)
    })

    it('ETH settlement', async () => {
      await setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(NativeAddress, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      const prevBalance0 = await user0.getBalance()
      const prevFeeTo0 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 10000, wallet.address, user0.address)
      expect(await user0.getBalance()).to.eq(prevBalance0.add(10000))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo0.add(0))

      await setBalance(feeSettlement.address, 10000)
      const prevBalance1 = await user1.getBalance()
      const prevFeeTo1 = await feeTo.getBalance()
      expect(await feeSettlement.processSettlement(NativeAddress, 9500, wallet.address, user1.address))
        .to.emit(feeSettlement, 'PayRebates')
      expect(await user1.getBalance()).to.eq(prevBalance1.add(9992))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo1.add(8))
    })
  })

  describe(('0.1% fee share, 20% fee discount, 25% fee rebate, with referrer'), () => {
    beforeEach(async () => {
      await feeSettlement.setFeeShare(10)
      await feeSettlement.setFeeDiscount(2000)
      await feeSettlement.setFeeRebate(2500)
      const code = keccak256("0xFF")
      await referralStorage.connect(user2).registerCode(code)
      await referralStorage.setReferralCodeByUser(code)
    })

    it('ERC20 settlement', async () => {
      await token0.setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(token0.address, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      await feeSettlement.processSettlement(token0.address, 10000, wallet.address, wallet.address)
      expect(await token0.balanceOf(wallet.address)).to.eq(10000)
      expect(await token0.balanceOf(feeTo.address)).to.eq(0)

      await token0.setBalance(feeSettlement.address, 10000)
      expect(await feeSettlement.processSettlement(token0.address, 9500, wallet.address, user0.address))
        .to.emit(feeSettlement, 'PayRebates')
      expect(await token0.balanceOf(user0.address)).to.eq(9992)
      expect(await token0.balanceOf(user2.address)).to.eq(2)
      expect(await token0.balanceOf(feeTo.address)).to.eq(6)
    })

    it('ETH settlement', async () => {
      await setBalance(feeSettlement.address, 10000)
      await expect(feeSettlement.processSettlement(NativeAddress, 11000, wallet.address, wallet.address))
        .to.be.revertedWithCustomError(feeSettlement, 'InsufficientOutAmount')

      const prevBalance0 = await user0.getBalance()
      const prevFeeTo0 = await feeTo.getBalance()
      await feeSettlement.processSettlement(NativeAddress, 10000, wallet.address, user0.address)
      expect(await user0.getBalance()).to.eq(prevBalance0.add(10000))
      expect(await feeTo.getBalance()).to.eq(prevFeeTo0.add(0))

      await setBalance(feeSettlement.address, 10000)
      const prevBalance1 = await user1.getBalance()
      const prevFeeTo1 = await feeTo.getBalance()
      expect(await feeSettlement.processSettlement(NativeAddress, 9500, wallet.address, user1.address))
        .to.emit(feeSettlement, 'PayRebates')
      expect(await user1.getBalance()).to.eq(prevBalance1.add(9992))
      expect(await weth.balanceOf(user2.address)).to.eq(2)
      expect(await feeTo.getBalance()).to.eq(prevFeeTo1.add(6))
    })
  })
})
