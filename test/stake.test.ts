import { expect, use } from "chai";
import { Contract, constants, BigNumber } from "ethers";
import { waffle } from "hardhat";
const { solidity } = waffle;
import { StakeFixture } from "./shared/fixtures"
import { expandTo10Decimals, mineBlockWithTimestamp } from './shared/utilities';

use(solidity);

const overrides = {
    gasLimit: 4100000
}

let startBlock= 1000
let endBlock = 11000
let stakePeriod = 10000

describe('Stake', () => {
    let provider = waffle.provider;

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

        // set reward
        totalReward = await rewardToken.totalSupply()
        await rewardToken.transfer(stake.address, totalReward, overrides)
        await stake.syncReward()
        await stakeToken.approve(stake.address, constants.MaxUint256, overrides)
        await stakeToken.connect(walletTo).approve(stake.address, constants.MaxUint256, overrides)
    });

    it('1 account stake all period', async () => {
        let stakeAmount = expandTo10Decimals(1)
        let rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)

        for (let index = 0; index < startBlock; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }

        await stake.stake(stakeAmount, overrides)

        for (let index = 0; index < stakePeriod; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }
        
        await stake.redeem(stakeAmount, overrides)
        await stake.claim()

        let rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(totalReward)

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    });

    it('1 account stake at different block', async() =>{
        let stakeAmount = expandTo10Decimals(1)
        let rewardBalanceBefore = await rewardToken.balanceOf(wallet.address)
        
        await stake.stake(stakeAmount, overrides)
        let beforeStake = startBlock - (await provider.getBlock('latest')).number

        for (let index = 0; index < beforeStake; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }

        for (let index = 0; index < 1000; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }
        await stake.stake(stakeAmount, overrides)

        for (let index = 0; index < 1000; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }
        await stake.stake(stakeAmount, overrides)

        for (let index = 0; index < stakePeriod - 2000; index++) {
            await mineBlockWithTimestamp(provider, (await provider.getBlock('latest')).timestamp + 12)
        }
        
        let stakeTokenReserve = await stakeToken.balanceOf(wallet.address)
        await stake.redeem(stakeAmount, overrides)
        expect(await stakeToken.balanceOf(wallet.address)).to.equal(stakeTokenReserve.add(stakeAmount))

        await stake.claim()
        
        let rewardBalanceAfter = await rewardToken.balanceOf(wallet.address)
        expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(totalReward)

        startBlock += (await provider.getBlock('latest')).number + 10
        endBlock = (startBlock + stakePeriod)
    })

    it("2 account stake at different block", async =>{
        
    })
});