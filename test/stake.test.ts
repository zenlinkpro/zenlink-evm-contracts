import { expect, use } from "chai";
import { Contract, constants, BigNumber } from "ethers";
const { waffle } = require("hardhat");
const { solidity } = waffle;
import { StakeFixture } from "./shared/fixtures"
import { expandTo10Decimals, mineBlockWithTimestamp } from './shared/utilities';

use(solidity);

const overrides = {
    gasLimit: 4100000
}

const DayInSeconds = 86400
const BspPenalty = 5000
const BspMax = 10000
const CoolDownInDay = 7

describe('Stake', () => {
    let provider = waffle.provider;

    const [wallet, walletTo] = provider.getWallets();

    let stakingPair: Contract
    let token0: Contract
    let token1: Contract
    let rewardToken: Contract
    let stake: Contract

    let totalReward: BigNumber

    beforeEach(async () => {
        const fixture = await StakeFixture(wallet);
        stakingPair = fixture.pair
        token0 = fixture.token0
        token1 = fixture.token1
        rewardToken = fixture.rewardToken
        stake = fixture.stake

        await token0.transfer(stakingPair.address, expandTo10Decimals(1000), overrides)
        await token1.transfer(stakingPair.address, expandTo10Decimals(1000), overrides)
        await stakingPair.mint(wallet.address, overrides)

        // set reward
        totalReward = await rewardToken.totalSupply()
        await rewardToken.transfer(stake.address, totalReward, overrides)
        await stake.setCooldownAndRageExitParam(CoolDownInDay, BspPenalty)
        await stakingPair.approve(stake.address, constants.MaxUint256, overrides)
        await stakingPair.connect(walletTo).approve(stake.address, constants.MaxUint256, overrides)
    });

    it('1 account stake all period', async () => {
        let stakeAmount = expandTo10Decimals(1)
        let rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        await stake.stake(stakeAmount, overrides)

        await stake.unstake(overrides)

        expect(await stake.balanceOf(wallet.address)).to.equal(stakeAmount)

        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + DayInSeconds * (CoolDownInDay))

        await stake.redeem(stakeAmount, overrides)
        let rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(totalReward)

        let stakeTotalSupply = await stake.totalSupply()
        expect(stakeTotalSupply).equal(0)
    });

    it('1 account stake and exit', async () => {
        let stakeAmount = expandTo10Decimals(1)
        let stakingPairBalanceInit = await stakingPair.balanceOf(wallet.address)
        const stakingTimeInDays = 2
        const stakingTimeInSeconds = (DayInSeconds * stakingTimeInDays) + 10

        let rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        await stake.stake(stakeAmount, overrides)
        let stakeTotalSupply = await stake.totalSupply()

        await stake.unstake(overrides)

        expect(await stake.balanceOf(wallet.address)).to.equal(stakeAmount)

        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + stakingTimeInSeconds)

        await stake.rageExit(overrides)

        let stakingTimeDiff = Math.floor(((DayInSeconds * CoolDownInDay - stakingTimeInSeconds) / DayInSeconds)) + 1;

        let penalty = stakeAmount.mul(stakingTimeDiff).mul(BspPenalty).div(BspMax).div(CoolDownInDay)
        let reward = (stakeAmount.sub(penalty)).mul(totalReward).div(stakeTotalSupply)

        let rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)

        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(reward)
        expect(await stakingPair.balanceOf(wallet.address)).to.equal(stakingPairBalanceInit)
    })

    it('2 account stake', async () => {
        let walletStakeAmount = expandTo10Decimals(1)
        let walletToStakeAmount = expandTo10Decimals(2)
        await stakingPair.transfer(walletTo.address, walletToStakeAmount)
        let walletStakingPairBalanceInit = await stakingPair.balanceOf(wallet.address)
        let walletToStakingPairBalanceInit = await stakingPair.balanceOf(walletTo.address)

        let walletRewardBalanceBefore = await rewardToken.balanceOf(wallet.address)
        let walletToRewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        await stake.connect(wallet).stake(walletStakeAmount)
        await stake.connect(walletTo).stake(walletToStakeAmount)
        let stakeTotalSupply = await stake.totalSupply()

        await stake.connect(wallet).unstake()
        await stake.connect(walletTo).unstake()

        const walletStakingTimeInDays = 2
        const walletToStakingTimeInDays = CoolDownInDay
        const walletStakingTimeInSeconds = (DayInSeconds * walletStakingTimeInDays) + 10
        const walletToStakingTimeInSeconds = (DayInSeconds * walletToStakingTimeInDays) + 10

        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + walletStakingTimeInSeconds)
        await stake.connect(wallet).rageExit(overrides)

        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + walletToStakingTimeInSeconds)
        await stake.connect(walletTo).redeem(walletToStakeAmount)

        let walletRewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        let walletToRewardBalanceAfter = await rewardToken.balanceOf(walletTo.address)

        let stakingTimeDiff = Math.floor(((DayInSeconds * CoolDownInDay - walletStakingTimeInSeconds) / DayInSeconds)) + 1;
        let walletPenalty = walletStakeAmount.mul(stakingTimeDiff).mul(BspPenalty).div(BspMax).div(CoolDownInDay)
        let walletReward = (walletStakeAmount.sub(walletPenalty)).mul(totalReward).div(stakeTotalSupply)

        expect(walletRewardBalanceAfter - walletRewardBalanceBefore).equal(walletReward)

        //WalletTo don't have penalty. So it get all reserve reward.
        expect(walletToRewardBalanceAfter - walletToRewardBalanceBefore)
            .equal(totalReward.sub(walletRewardBalanceAfter - walletRewardBalanceBefore))


        expect(await stakingPair.balanceOf(wallet.address)).to.equal(walletStakingPairBalanceInit)
        expect(await stakingPair.balanceOf(walletTo.address)).to.equal(walletToStakingPairBalanceInit)
    })

    it('transfer staking to no staking account', async () => {
        let stakeAmount = expandTo10Decimals(2)
        await stake.stake(stakeAmount, overrides)
        await stake.unstake(overrides)

        let stakingTimeInDays = 3
        const stakingTimeInSeconds = (DayInSeconds * stakingTimeInDays) + 10

        // After 3 day, wallet transfer staking share to a new account
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + stakingTimeInSeconds)
        await stake.transfer(walletTo.address, stakeAmount.div(2))
        await stake.connect(walletTo).unstake()

        // After 4 day, wallet can redeem. But walletTo can't
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 4) + 10)
        await expect(stake.redeem(stakeAmount.div(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(wallet.address, stakeAmount.div(2), totalReward.div(2), 0)

        await expect(stake.connect(walletTo).redeem(stakeAmount.div(2))).to.be.revertedWith("Still in cooldown")

        // After 3 day, walletTo can redeem.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 3) + 10)
        await expect(stake.connect(walletTo).redeem(stakeAmount.div(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(walletTo.address, stakeAmount.div(2), totalReward.div(2), 0)
    })

    it('transfer staking to newly account', async () => {
        let stakeAmount = expandTo10Decimals(1)
        await stakingPair.transfer(walletTo.address, stakeAmount)

        await stake.stake(stakeAmount, overrides)
        await stake.unstake(overrides)

        let stakingTimeInDays = 3
        const stakingTimeInSeconds = (DayInSeconds * stakingTimeInDays) + 10

        // After 3 day, 
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + stakingTimeInSeconds)

        // After 4 day, walletTo stake. and wallet transfer some stake share to walletTo.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 4) + 10)
        await stake.connect(walletTo).stake(stakeAmount)
        await stake.connect(walletTo).unstake()
        await stake.transfer(walletTo.address, stakeAmount.div(2))

        await expect(stake.redeem(stakeAmount.div(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(wallet.address, stakeAmount.div(2), totalReward.div(4), 0)

        await expect(stake.connect(walletTo).redeem(stakeAmount.div(2))).to.be.revertedWith("Still in cooldown")

        // After 3 day, walletTo can't redeem.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 3) - 10)

        await expect(stake.connect(walletTo).redeem(stakeAmount.div(2))).to.be.revertedWith("Still in cooldown")

        // After 4 day, walletTo can redeem.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 4) + 10)
        await expect(stake.connect(walletTo).redeem(stakeAmount.mul(3).div(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(walletTo.address, stakeAmount.mul(3).div(2), totalReward.mul(3).div(4), 0)
    })

    it('transfer staking to older account in cooldown period', async () => {
        let stakeAmount = expandTo10Decimals(1)
        await stakingPair.transfer(walletTo.address, stakeAmount)

        await stake.connect(walletTo).stake(stakeAmount)
        await stake.connect(walletTo).unstake()
        let toTimestamp = (await provider.getBlock('latest')).timestamp
        // After 3 day, wallet begin stake.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 3))
        await stake.stake(stakeAmount)
        await stake.unstake()
        let fromTimestamp = (await provider.getBlock('latest')).timestamp
        await stake.transfer(walletTo.address, stakeAmount)

        let walletToCoolDownStartTimeStamp = stakeAmount.mul(fromTimestamp).add(stakeAmount.mul(toTimestamp)).div(stakeAmount.add(stakeAmount)).toNumber()

        await mineBlockWithTimestamp(provider, walletToCoolDownStartTimeStamp + (DayInSeconds * 7) - 10)
        await expect(stake.connect(walletTo).redeem(stakeAmount.mul(2))).to.be.revertedWith("Still in cooldown")

        await mineBlockWithTimestamp(provider, walletToCoolDownStartTimeStamp + (DayInSeconds * 7))
        await expect(stake.connect(walletTo).redeem(stakeAmount.mul(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(walletTo.address, stakeAmount.mul(2), totalReward, 0)
    })

    it('transfer staking to older account out cooldown period', async () => {
        let stakeAmount = expandTo10Decimals(1)
        await stakingPair.transfer(walletTo.address, stakeAmount)

        await stake.connect(walletTo).stake(stakeAmount)
        await stake.connect(walletTo).unstake()

        // After 8 days.
        await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + (DayInSeconds * 8))
        await stake.connect(wallet).stake(stakeAmount)
        await stake.transfer(walletTo.address, stakeAmount)

        await expect(stake.connect(walletTo).redeem(stakeAmount)).to.be.revertedWith("Still in cooldown")
        let fromTimestamp = (await provider.getBlock('latest')).timestamp
        let toTimestamp = fromTimestamp - DayInSeconds * 7
        let walletToCoolDownStartTimeStamp = stakeAmount.mul(fromTimestamp).add(stakeAmount.mul(toTimestamp)).div(stakeAmount.add(stakeAmount)).toNumber()


        await mineBlockWithTimestamp(provider, walletToCoolDownStartTimeStamp + (DayInSeconds * 7))

        await expect(stake.connect(walletTo).redeem(stakeAmount.mul(2)))
            .to.emit(stake, 'Redeem')
            .withArgs(walletTo.address, stakeAmount.mul(2), totalReward, 0)
    })

    //***********admin control**************/
    it('only admin pause and set stake params', async () => {
        await expect(stake.connect(walletTo).setCooldownAndRageExitParam(CoolDownInDay, BspPenalty)).to.be.revertedWith('not admin')

        await expect(stake.connect(walletTo).pause()).to.be.revertedWith('not admin')
        await expect(stake.pause()).to.emit(stake, 'Paused').withArgs(wallet.address)
        let stakeAmount = expandTo10Decimals(1)

        await expect(stake.stake(stakeAmount, overrides)).to.be.revertedWith('Pausable: paused')

        await expect(stake.connect(walletTo).unpause()).to.be.revertedWith('not admin')
        await expect(stake.unpause()).to.emit(stake, 'Unpaused').withArgs(wallet.address)

        await expect(stake.stake(stakeAmount, overrides))
            .to.emit(stake, 'Transfer')
            .withArgs('0x0000000000000000000000000000000000000000', wallet.address, stakeAmount)
            .to.emit(stake, 'Staked')
            .withArgs(wallet.address, stakeAmount, stakeAmount)
    })

    it('set admin', async () => {
        await expect(stake.connect(walletTo).setAdminCandidate(walletTo.address)).to.be.revertedWith('not admin')

        await expect(stake.connect(wallet).setAdminCandidate(walletTo.address)).to.emit(stake, 'Candidate').withArgs(walletTo.address)

        await expect(stake.connect(walletTo).candidateConfirm()).to.emit(stake, 'AdminChanged').withArgs(wallet.address, walletTo.address)
    })
});