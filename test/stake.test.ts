import { expect, use } from "chai";
import { MockProvider } from "ethereum-waffle";
import { Contract, constants, BigNumber } from "ethers";
import { waffle } from "hardhat";
import { StakeFixture } from "./shared/fixtures"
import { createTimeMachine } from "./shared/time";
import { expandTo10Decimals } from './shared/utilities';

use(waffle.solidity);

const overrides = {
    gasLimit: 4100000
}

let startBlock = 1000
let endBlock = 2000
let stakePeriod = 1000

describe('Stake', () => {
    const provider: MockProvider = waffle.provider;
    const time = createTimeMachine(provider);

    const [wallet, walletTo] = provider.getWallets();

    let stakeToken: Contract
    let token0: Contract
    let token1: Contract
    let rewardToken: Contract
    let stake: Contract

    let totalReward: BigNumber

    beforeEach(async () => {
        const fixture = await StakeFixture(wallet, startBlock, endBlock);
        stakeToken = fixture.pair
        token0 = fixture.token0
        token1 = fixture.token1
        rewardToken = fixture.rewardToken
        stake = fixture.stake

        await token0.transfer(stakeToken.address, expandTo10Decimals(1000), overrides)
        await token1.transfer(stakeToken.address, expandTo10Decimals(1000), overrides)
        await stakeToken.mint(wallet.address, overrides)
        await stakeToken.transfer(walletTo.address, expandTo10Decimals(500), overrides)
        // set reward
        totalReward = await rewardToken.totalSupply()
        await rewardToken.transfer(stake.address, totalReward, overrides)
        await stake.syncReward()
        await stakeToken.approve(stake.address, constants.MaxUint256, overrides)
        await stakeToken.connect(walletTo).approve(stake.address, constants.MaxUint256, overrides)
    });

    it('1 account stake all period', async () => {
        const stakeAmount = expandTo10Decimals(1)
        const rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        await time.advanceBlockTo(startBlock)
        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(endBlock)
        await stake.redeem(stakeAmount, overrides)
        await stake.claim()

        const rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(totalReward)

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    });

    it("pause", async () => {
        const stakeAmount = expandTo10Decimals(1)

        await stake.pauseStake()
        await expect(stake.connect(walletTo).unpauseStake(overrides)).to.be.revertedWith('not admin')
        await expect(stake.stake(stakeAmount, overrides)).to.be.revertedWith("STAKE_PAUSED")
        await stake.unpauseStake(overrides)
        await expect(await stake.stake(stakeAmount, overrides))
            .to.emit(stake, "Staked")
            .withArgs(wallet.address, stakeAmount, stakeAmount.mul(stakePeriod))

        await stake.pauseRedeem()
        await expect(stake.connect(walletTo).unpauseRedeem(overrides)).to.be.revertedWith('not admin')
        await stake.unpauseRedeem(overrides)
        await expect(stake.redeem(stakeAmount, overrides)).to.be.revertedWith('STAKE_NOT_STARTED')

        await stake.pauseClaim()
        await expect(stake.connect(walletTo).unpauseClaim(overrides)).to.be.revertedWith('not admin')
        await stake.unpauseClaim(overrides)
        await expect(stake.claim(overrides)).to.be.revertedWith('STAKE_NOT_FINISHED')
    })

    it('1 account stake at different block', async() =>{
        const stakeAmount = expandTo10Decimals(1)
        const rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock)

        // staking start
        await time.advanceBlockTo(startBlock + 100)

        // after 1000 block, wallet add stake amount
        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock + 200)

        // after 2000 block, wallet add stake amount
        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(endBlock)

        // staking end
        const stakeTokenReserve = await stakeToken.balanceOf(wallet.address)
        await stake.redeem(stakeAmount, overrides)
        expect(await stakeToken.balanceOf(wallet.address)).to.equal(stakeTokenReserve.add(stakeAmount))

        await stake.claim()

        const rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(totalReward)

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    })

    it("2 account stake at different block: redeem first", async() =>{
        const stakeAmount = expandTo10Decimals(1)
        const rewardBalanceBeforeWallet = await rewardToken.balanceOf(wallet.address)
        const rewardBalanceBeforeWalletTo = await rewardToken.balanceOf(walletTo.address)

        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock)

        // staking start
        await time.advanceBlockTo(startBlock + 99)

        // after staking begin 1000 block, walletTo stake
        await stake.connect(walletTo).stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock + 199)

        // after staking begin 2000 block, wallet redeem half of stake amount.
        const stakeTokenAmount = await stakeToken.balanceOf(wallet.address);
        await stake.connect(wallet).redeem(stakeAmount.div(2), overrides)
        expect(stakeTokenAmount.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(wallet.address)))
        await time.advanceBlockTo(startBlock + 399)

        // after staking begin 4000 block, walletTo redeem half stake amount.
        const stakeTokenAmountWalletTo = await stakeToken.balanceOf(walletTo.address)
        await stake.connect(walletTo).redeem(stakeAmount.div(2), overrides)
        expect(stakeTokenAmountWalletTo.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(walletTo.address)))
        await time.advanceBlockTo(endBlock)

        // stake end
        await stake.connect(wallet).redeem(stakeAmount.div(2), overrides)
        await stake.connect(walletTo).redeem(stakeAmount.div(2), overrides)
        await stake.connect(wallet).claim()
        await stake.connect(walletTo).claim()

        const rewardBalanceAfterWallet = await rewardToken.balanceOf(wallet.address)
        const rewardBalanceAfterWalletTo = await rewardToken.balanceOf(walletTo.address)

        //walletInterest = (10000000000 × 10000 − (10000000000) / 2 × (10000 − 2000));
        const walletInterest = BigNumber.from(6000000000000);

        // walletToInterest =  (10000000000 × (10000 − 1000) − 10000000000 /2 × (10000 − 6000))
        const walletToInterest = BigNumber.from(7000000000000);
        expect(rewardBalanceAfterWallet - rewardBalanceBeforeWallet)
            .equal(walletInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

        expect(rewardBalanceAfterWalletTo - rewardBalanceBeforeWalletTo)
            .equal(walletToInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    }).timeout(50000)

    it("2 account stake at different block: claim first", async() =>{
        const stakeAmount = expandTo10Decimals(1)
        const rewardBalanceBeforeWallet = await rewardToken.balanceOf(wallet.address)
        const rewardBalanceBeforeWalletTo = await rewardToken.balanceOf(walletTo.address)

        await stake.stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock)

        // staking start
        await time.advanceBlockTo(startBlock + 99)

        // after staking begin 1000 block, walletTo stake
        await stake.connect(walletTo).stake(stakeAmount, overrides)
        await time.advanceBlockTo(startBlock + 199)

        // after staking begin 2000 block, wallet redeem half of stake amount.
        const stakeTokenAmount = await stakeToken.balanceOf(wallet.address);
        await stake.connect(wallet).redeem(stakeAmount.div(2), overrides)
        expect(stakeTokenAmount.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(wallet.address)))
        await time.advanceBlockTo(startBlock + 399)

        // after staking begin 4000 block, walletTo redeem half stake amount.
        const stakeTokenAmountWalletTo = await stakeToken.balanceOf(walletTo.address)
        await stake.connect(walletTo).redeem(stakeAmount.div(2), overrides)
        expect(stakeTokenAmountWalletTo.add(stakeAmount.div(2))).to.equal((await stakeToken.balanceOf(walletTo.address)))
        await time.advanceBlockTo(endBlock)

        // stake end
        await time.advanceBlockTo(endBlock + 1)
        await stake.connect(wallet).claim()
        await time.advanceBlockTo(endBlock + 2)
        await stake.connect(wallet).redeem(stakeAmount.div(2), overrides)
        await time.advanceBlockTo(endBlock + 3)
        await stake.connect(walletTo).claim()
        await time.advanceBlockTo(endBlock + 4)
        await stake.connect(walletTo).redeem(stakeAmount.div(2), overrides)

        const rewardBalanceAfterWallet = await rewardToken.balanceOf(wallet.address)
        const rewardBalanceAfterWalletTo = await rewardToken.balanceOf(walletTo.address)

        //walletInterest = (10000000000 × 10000 − (10000000000) / 2 × (10000 − 2000));
        const walletInterest = BigNumber.from(6000000000000);

        // walletToInterest =  (10000000000 × (10000 − 1000) − 10000000000 /2 × (10000 − 6000))
        const walletToInterest = BigNumber.from(7000000000000);
        expect(rewardBalanceAfterWallet - rewardBalanceBeforeWallet)
            .equal(walletInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

        expect(rewardBalanceAfterWalletTo - rewardBalanceBeforeWalletTo)
            .equal(walletToInterest.mul(totalReward).div(walletInterest.add(walletToInterest)));

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    }).timeout(50000)

    it("blacklist", async () => {
        await time.advanceBlockTo(startBlock)
        
        const stakeAmount = expandTo10Decimals(1)
        await stake.connect(walletTo).stake(stakeAmount, overrides)
        await stake.setBlackList(walletTo.address)
        await expect(stake.connect(walletTo).stake(stakeAmount, overrides)).to.be.revertedWith('IN_BLACK_LIST')
        await expect(stake.connect(walletTo).redeem(stakeAmount, overrides)).to.be.revertedWith('IN_BLACK_LIST')
        await time.advanceBlockTo(endBlock)

        await expect(stake.connect(walletTo).claim(overrides)).to.be.revertedWith('IN_BLACK_LIST')

        await stake.removeBlackList(walletTo.address)
        await expect(stake.connect(walletTo).claim(overrides))
            .to.emit(stake, 'RewardsClaimed')
            .withArgs(walletTo.address, totalReward)
    }).timeout(50000)
});