import { expect, use } from "chai";
import { deployContract, MockProvider, solidity } from "ethereum-waffle";
import { Contract, constants, BigNumber } from "ethers";
import { StakeFixture } from "./shared/fixtures"
import { createTimeMachine } from "./shared/time";
import { expandTo10Decimals } from './shared/utilities';

import BasicToken from '../build/contracts/test/BasicToken.sol/BasicToken.json'

use(solidity);

async function advanceStartBlock (
    provider: MockProvider, 
    blocks: number, 
    periodBlocks: number
): Promise<[number, number]> {
    const currentBlock = (await provider.getBlock('latest')).number
    const startBlock = currentBlock + blocks

    return [startBlock, startBlock + periodBlocks]
}

const overrides = {
    gasLimit: 4100000
}

let startBlock = 1000
let endBlock = 2000
let stakePeriod = 1000

describe('Stake', () => {
    const provider = new MockProvider({
        ganacheOptions: {
          hardfork: 'istanbul',
          mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
          gasLimit: 9999999,
        },
    })
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
        totalReward = BigNumber.from('100000000')
        await rewardToken.approve(stake.address, constants.MaxUint256, overrides)
        await stake.addReward(totalReward, overrides)
        await stakeToken.approve(stake.address, constants.MaxUint256, overrides)
        await stakeToken.connect(walletTo).approve(stake.address, constants.MaxUint256, overrides)
    });

    afterEach(async () => {
        [startBlock, endBlock] = await advanceStartBlock(provider, 100, stakePeriod)
    })

    it('add reward', async () => {
        const amountOfRewardToAdd = BigNumber.from('100000000')
        const previousRewardAmount = await stake.totalRewardAmount();
        await stake.addReward(amountOfRewardToAdd, overrides);
        const currentRewardAmount = await stake.totalRewardAmount();

        expect(amountOfRewardToAdd.add(previousRewardAmount)).to.equal(currentRewardAmount);
    })

    it('remove reward', async () => {
        const amountOfRewardToRemove = BigNumber.from('50000000')
        const previousRewardAmount = await stake.totalRewardAmount();
        await stake.removeReward(amountOfRewardToRemove, overrides);
        const currentRewardAmount = await stake.totalRewardAmount();

        expect(previousRewardAmount.sub(amountOfRewardToRemove)).to.equal(currentRewardAmount);
    })

    it('remove reward: fail', async () => {
        const amountOfRewardToRemove = BigNumber.from('110000000')
        await expect(
            stake.removeReward(amountOfRewardToRemove, overrides)
        ).to.be.revertedWith('INSUFFICIENT_REWARD_AMOUNT');
    })

    it('withdrawExtraFunds: other token', async () => {
        const otherToken = await deployContract(
            wallet, 
            BasicToken, 
            ["other Token", "OT", 18, expandTo10Decimals(500)], 
            overrides
        )
        const transferAmount = expandTo10Decimals(200)
        await otherToken.transfer(stake.address, transferAmount, overrides)
        expect(await otherToken.balanceOf(stake.address)).to.equal(transferAmount)
        expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(300))
        await stake.withdrawExtraFunds(otherToken.address, wallet.address, expandTo10Decimals(100), overrides)
        expect(await otherToken.balanceOf(stake.address)).to.equal(expandTo10Decimals(100))
        expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(400))
    })

    it('withdrawExtraFunds: reward token', async () => {
        const amountOfRewardToRemove = BigNumber.from('50000000')
        await stake.removeReward(amountOfRewardToRemove, overrides)
        await rewardToken.transfer(stake.address, BigNumber.from('10000000'), overrides)
        expect(await rewardToken.balanceOf(stake.address)).to.equal(BigNumber.from('60000000'))
        await stake.withdrawExtraFunds(rewardToken.address, wallet.address, BigNumber.from('10000000'), overrides)
        expect(await rewardToken.balanceOf(stake.address)).to.equal(BigNumber.from('50000000'))
        await expect(
            stake.withdrawExtraFunds(rewardToken.address, wallet.address, BigNumber.from('1'), overrides)
        ).to.be.revertedWith('INSUFFICIENT_REWARD_BALANCE');
    })

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
    })

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
    })
});