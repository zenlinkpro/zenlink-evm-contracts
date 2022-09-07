import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { constants, BigNumber, ContractFactory } from "ethers";
import { deployments } from "hardhat";
import { BasicToken, Pair, Stake } from "../typechain-types";
import { forceAdvanceBlocksTo } from "./shared/time";
import { expandTo10Decimals } from './shared/utilities';

let startBlock = 100
let endBlock = 700
let stakePeriod = 600

describe('Stake', () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let walletTo: SignerWithAddress

  let basicTokenFactory: ContractFactory

  let stakeToken: Pair
  let token0: BasicToken
  let token1: BasicToken
  let rewardToken: BasicToken
  let stake: Stake

  let totalReward: BigNumber

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
        ;[wallet, walletTo] = signers

      const factoryFactory = await ethers.getContractFactory('Factory')
      const factory = await factoryFactory.deploy(wallet.address)

      basicTokenFactory = await ethers.getContractFactory('BasicToken')
      const tokenA = (await basicTokenFactory.deploy("TokenA", "TA", 18, '1549903311500105273839447')) as BasicToken
      const tokenB = (await basicTokenFactory.deploy("TokenB", "TB", 18, '1403957892781062528318836')) as BasicToken

      await factory.createPair(tokenA.address, tokenB.address)
      const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
      stakeToken = (await ethers.getContractAt('Pair', pairAddress)) as Pair

      const token0Address = (await stakeToken.token0())
      token0 = tokenA.address === token0Address ? tokenA : tokenB
      token1 = tokenA.address === token0Address ? tokenB : tokenA
      rewardToken = (await basicTokenFactory.deploy("stake reward", "SR", 18, expandTo10Decimals(1))) as BasicToken

      const stakeFactory = await ethers.getContractFactory('Stake')
      stake = (await stakeFactory.deploy(stakeToken.address, rewardToken.address, startBlock, endBlock)) as Stake

      await token0.transfer(stakeToken.address, expandTo10Decimals(1000))
      await token1.transfer(stakeToken.address, expandTo10Decimals(1000))
      await stakeToken.mint(wallet.address)
      await stakeToken.transfer(walletTo.address, expandTo10Decimals(500))
      // set reward
      totalReward = BigNumber.from('100000000')
      await rewardToken.approve(stake.address, constants.MaxUint256)
      await stake.addReward(totalReward)
      await stakeToken.approve(stake.address, constants.MaxUint256)
      await stakeToken.connect(walletTo).approve(stake.address, constants.MaxUint256)
    }
  )

  beforeEach(async () => {
    await setupTest()
  });

  it('add reward', async () => {
    const amountOfRewardToAdd = BigNumber.from('100000000')
    const previousRewardAmount = await stake.totalRewardAmount();
    await stake.addReward(amountOfRewardToAdd);
    const currentRewardAmount = await stake.totalRewardAmount();

    expect(amountOfRewardToAdd.add(previousRewardAmount)).to.equal(currentRewardAmount);
  })

  it('remove reward', async () => {
    const amountOfRewardToRemove = BigNumber.from('50000000')
    const previousRewardAmount = await stake.totalRewardAmount();
    await stake.removeReward(amountOfRewardToRemove);
    const currentRewardAmount = await stake.totalRewardAmount();

    expect(previousRewardAmount.sub(amountOfRewardToRemove)).to.equal(currentRewardAmount);
  })

  it('remove reward: fail', async () => {
    const amountOfRewardToRemove = BigNumber.from('110000000')
    await expect(
      stake.removeReward(amountOfRewardToRemove)
    ).to.be.revertedWith('INSUFFICIENT_REWARD_AMOUNT');
  })

  it('withdrawExtraFunds: other token', async () => {
    const otherToken = await basicTokenFactory.deploy("other Token", "OT", 18, expandTo10Decimals(500))
    const transferAmount = expandTo10Decimals(200)
    await otherToken.transfer(stake.address, transferAmount)
    expect(await otherToken.balanceOf(stake.address)).to.equal(transferAmount)
    expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(300))
    await stake.withdrawExtraFunds(otherToken.address, wallet.address, expandTo10Decimals(100))
    expect(await otherToken.balanceOf(stake.address)).to.equal(expandTo10Decimals(100))
    expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(400))
  })

  it('withdrawExtraFunds: reward token', async () => {
    const amountOfRewardToRemove = BigNumber.from('50000000')
    await stake.removeReward(amountOfRewardToRemove)
    await rewardToken.transfer(stake.address, BigNumber.from('10000000'))
    expect(await rewardToken.balanceOf(stake.address)).to.equal(BigNumber.from('60000000'))
    await stake.withdrawExtraFunds(rewardToken.address, wallet.address, BigNumber.from('10000000'))
    expect(await rewardToken.balanceOf(stake.address)).to.equal(BigNumber.from('50000000'))
    await expect(
      stake.withdrawExtraFunds(rewardToken.address, wallet.address, BigNumber.from('1'))
    ).to.be.revertedWith('INSUFFICIENT_REWARD_BALANCE');
  })

  it('1 account stake all period', async () => {
    const stakeAmount = expandTo10Decimals(1)
    const rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

    await forceAdvanceBlocksTo(startBlock)
    await stake.stake(stakeAmount)
    await forceAdvanceBlocksTo(endBlock)
    await stake.redeem(stakeAmount)
    await stake.claim()

    const rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
    expect(rewardBalanceAfter.sub(rewardBalanceBefore)).to.equal(totalReward)
  });

  it("pause", async () => {
    const stakeAmount = expandTo10Decimals(1)

    await stake.pauseStake()
    await expect(stake.connect(walletTo).unpauseStake()).to.be.revertedWith('not admin')
    await expect(stake.stake(stakeAmount)).to.be.revertedWith("STAKE_PAUSED")
    await stake.unpauseStake()
    await expect(await stake.stake(stakeAmount))
      .to.emit(stake, "Staked")
      .withArgs(wallet.address, stakeAmount, stakeAmount.mul(stakePeriod))
  })

  it('1 account stake at different block', async () => {
    const stakeAmount = expandTo10Decimals(1)
    const rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

    await stake.stake(stakeAmount)
    await forceAdvanceBlocksTo(startBlock)

    // staking start
    await forceAdvanceBlocksTo(startBlock + 100)

    // after 1000 block, wallet add stake amount
    await stake.stake(stakeAmount)
    await forceAdvanceBlocksTo(startBlock + 200)

    // after 2000 block, wallet add stake amount
    await stake.stake(stakeAmount)
    await forceAdvanceBlocksTo(endBlock)

    // staking end
    const stakeTokenReserve = await stakeToken.balanceOf(wallet.address)
    await stake.redeem(stakeAmount)
    expect(await stakeToken.balanceOf(wallet.address)).to.equal(stakeTokenReserve.add(stakeAmount))

    await stake.claim()

    const rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
    expect(rewardBalanceAfter.sub(rewardBalanceBefore)).to.equal(totalReward)
  })

  it("2 account stake at different block: redeem first", async () => {
    const stakeAmount = expandTo10Decimals(1)
    const rewardBalanceBeforeWallet = await rewardToken.balanceOf(wallet.address)
    const rewardBalanceBeforeWalletTo = await rewardToken.balanceOf(walletTo.address)

    await stake.stake(stakeAmount)
    await forceAdvanceBlocksTo(startBlock)

    // staking start
    await forceAdvanceBlocksTo(startBlock + 99)

    // after staking begin 1000 block, walletTo stake
    await stake.connect(walletTo).stake(stakeAmount)
    await forceAdvanceBlocksTo(startBlock + 199)

    // after staking begin 2000 block, wallet redeem half of stake amount.
    const stakeTokenAmount = await stakeToken.balanceOf(wallet.address);
    await stake.connect(wallet).redeem(stakeAmount.div(2))
    expect(stakeTokenAmount.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(wallet.address)))
    await forceAdvanceBlocksTo(startBlock + 399)

    // after staking begin 4000 block, walletTo redeem half stake amount.
    const stakeTokenAmountWalletTo = await stakeToken.balanceOf(walletTo.address)
    await stake.connect(walletTo).redeem(stakeAmount.div(2))
    expect(stakeTokenAmountWalletTo.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(walletTo.address)))
    await forceAdvanceBlocksTo(endBlock)

    // stake end
    await stake.connect(wallet).redeem(stakeAmount.div(2))
    await stake.connect(walletTo).redeem(stakeAmount.div(2))
    await stake.connect(wallet).claim()
    await stake.connect(walletTo).claim()

    const rewardBalanceAfterWallet = await rewardToken.balanceOf(wallet.address)
    const rewardBalanceAfterWalletTo = await rewardToken.balanceOf(walletTo.address)

    //walletInterest = (10000000000 × 1000 − (10000000000) / 2 × (1000 − 200));
    const walletInterest = BigNumber.from(6000000000000);

    // walletToInterest =  (10000000000 × (1000 − 100) − 10000000000 / 2 × (1000 − 400))
    const walletToInterest = BigNumber.from(6000000000000);
    expect(rewardBalanceAfterWallet.sub(rewardBalanceBeforeWallet))
      .equal(walletInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

    expect(rewardBalanceAfterWalletTo.sub(rewardBalanceBeforeWalletTo))
      .equal(walletToInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));
  })

  it("2 account stake at different block: claim first", async () => {
    const stakeAmount = expandTo10Decimals(1)
    const rewardBalanceBeforeWallet = await rewardToken.balanceOf(wallet.address)
    const rewardBalanceBeforeWalletTo = await rewardToken.balanceOf(walletTo.address)

    await stake.stake(stakeAmount)

    // staking start
    await forceAdvanceBlocksTo(startBlock + 99)

    // after staking begin 1000 block, walletTo stake
    await stake.connect(walletTo).stake(stakeAmount)
    await forceAdvanceBlocksTo(startBlock + 199)

    // after staking begin 2000 block, wallet redeem half of stake amount.
    const stakeTokenAmount = await stakeToken.balanceOf(wallet.address);
    await stake.connect(wallet).redeem(stakeAmount.div(2))
    expect(stakeTokenAmount.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(wallet.address)))
    await forceAdvanceBlocksTo(startBlock + 399)

    // after staking begin 4000 block, walletTo redeem half stake amount.
    const stakeTokenAmountWalletTo = await stakeToken.balanceOf(walletTo.address)
    await stake.connect(walletTo).redeem(stakeAmount.div(2))
    expect(stakeTokenAmountWalletTo.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(walletTo.address)))
    await forceAdvanceBlocksTo(endBlock)

    // stake end
    await forceAdvanceBlocksTo(endBlock + 1)
    await stake.connect(wallet).claim()
    await forceAdvanceBlocksTo(endBlock + 2)
    await stake.connect(wallet).redeem(stakeAmount.div(2))
    await forceAdvanceBlocksTo(endBlock + 3)
    await stake.connect(walletTo).claim()
    await forceAdvanceBlocksTo(endBlock + 4)
    await stake.connect(walletTo).redeem(stakeAmount.div(2))

    const rewardBalanceAfterWallet = await rewardToken.balanceOf(wallet.address)
    const rewardBalanceAfterWalletTo = await rewardToken.balanceOf(walletTo.address)

    //walletInterest = (10000000000 × 1000 − (10000000000) / 2 × (10000 − 200));
    const walletInterest = BigNumber.from(6000000000000);

    // walletToInterest =  (10000000000 × (1000 − 100) − 10000000000 / 2 × (10000 − 400))
    const walletToInterest = BigNumber.from(6000000000000);
    expect(rewardBalanceAfterWallet.sub(rewardBalanceBeforeWallet))
      .equal(walletInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

    expect(rewardBalanceAfterWalletTo.sub(rewardBalanceBeforeWalletTo))
      .equal(walletToInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));
  })
});
