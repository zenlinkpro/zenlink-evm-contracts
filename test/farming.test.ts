import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, constants } from 'ethers'

import TestERC20 from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import Farming from '../build/contracts/periphery/Farming.sol/Farming.json'
import { createTimeMachine } from './shared/time'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

type MaybeInfo = any

interface PoolInfo {
  farmingToken: string;
  amount: BigNumber;
  rewardTokens: string[];
  rewardPerBlock: BigNumber[];
  accRewardPerShare: BigNumber[];
  lastRewardBlock: BigNumber;
  startBlock: BigNumber;
  claimableInterval: BigNumber
}

interface UserInfo {
  amount: BigNumber;
  rewardDebt: BigNumber[];
  pending: BigNumber[];
  nextClaimableBlock: BigNumber;
}

function parsePoolInfo({
  farmingToken,
  amount,
  rewardTokens,
  rewardPerBlock,
  accRewardPerShare,
  lastRewardBlock,
  startBlock,
  claimableInterval
}: MaybeInfo): PoolInfo {
  return {
    farmingToken,
    amount,
    rewardTokens,
    rewardPerBlock,
    accRewardPerShare,
    lastRewardBlock,
    startBlock,
    claimableInterval
  }
}

function parseUserInfo({
  amount,
  rewardDebt,
  pending,
  nextClaimableBlock
}: MaybeInfo): UserInfo {
  return {
    amount,
    rewardDebt,
    pending,
    nextClaimableBlock
  }
}

describe('Farming', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const Time = createTimeMachine(provider);

  const wallets = provider.getWallets()
  const [wallet0, wallet1] = wallets

  let tokenA: Contract,
    tokenB: Contract,
    tokenC: Contract
  beforeEach('deploy token', async () => {
    tokenA = await deployContract(wallet0, TestERC20, ['TokenA', 'TA', 18, 0], overrides)
    tokenB = await deployContract(wallet0, TestERC20, ['TokenB', 'TB', 18, 0], overrides)
    tokenC = await deployContract(wallet0, TestERC20, ['TokenC', 'TC', 18, 0], overrides)
  })

  describe('poolLength', () => {
    it('returns zero length after deploy', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      expect(await farming.poolLength()).to.eq(BigNumber.from(0))
    })

    it('returns one length after add one pool', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await farming.add(tokenA.address, [tokenB.address], [0], 0, 10)
      expect(await farming.poolLength()).to.eq(BigNumber.from(1))
    })
  })

  describe('poolInfo', () => {
    describe('add', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
      })

      it('fails for invalid rewardPerBlock', async () => {
        await expect(farming.add(tokenA.address, [tokenB.address, tokenC.address], [100], 0, 10))
          .to.be.revertedWith('INVALID_REWARDS')
      })

      it('successful add and check poolInfo', async () => {
        await expect(farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10))
          .to.emit(farming, 'PoolAdded').withArgs(tokenA.address)
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        const blockNumber = await provider.getBlockNumber()
        expect(poolInfo).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(0),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(100), BigNumber.from(200)],
          accRewardPerShare: [BigNumber.from(0), BigNumber.from(0)],
          lastRewardBlock: BigNumber.from(blockNumber > 10 ? blockNumber : 10),
          startBlock: BigNumber.from(10),
          claimableInterval: BigNumber.from(10)
        })
      })
    })

    describe('set', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
      })

      it('fails for different rewardPerBlock length', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
        await expect(farming.set(0, [200], false)).to.be.revertedWith('INVALID_REWARDS')
      })

      it('successful set and check poolInfo', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
        await farming.set(0, [200, 300], false)
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfo).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(0),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(200), BigNumber.from(300)],
          accRewardPerShare: [BigNumber.from(0), BigNumber.from(0)],
          lastRewardBlock: poolInfo.lastRewardBlock,
          startBlock: poolInfo.startBlock,
          claimableInterval: poolInfo.claimableInterval
        })
      })

      it('set with update and not with update', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
        const poolInfoBeforeSet = parsePoolInfo(await farming.getPoolInfo(0))
        // current BlockNumber: 39
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await tokenA.setBalance(wallet0.address, 400)
        await farming.stake(0, tokenA.address, 200)
        // current BlockNumber: 42
        // lastRewardBlock = 42
        await farming.set(0, [200, 300], true)
        // current BlockNumber: 43
        // lastRewardBlock = 43
        const blockNumber = await provider.getBlockNumber()
        const poolInfoAfterSetWithUpdate = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfoAfterSetWithUpdate).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(200),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(200), BigNumber.from(300)],
          // 1 * 100 * 10^12 / 200 = 500_000_000_000, 1 * 200 * 10^12 / 200 = 1_000_000_000_000
          accRewardPerShare: [BigNumber.from(500_000_000_000), BigNumber.from(1_000_000_000_000)],
          lastRewardBlock: BigNumber.from(blockNumber > 10 ? blockNumber : 10),
          startBlock: poolInfoBeforeSet.startBlock,
          claimableInterval: poolInfoBeforeSet.claimableInterval
        })
        // this will change pool.lastRewardBlock if withUpdate = true
        await Time.advanceBlockTo(50)
        await farming.set(0, [300, 400], false)
        const poolInfoAfterSetNotWithUpdate = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfoAfterSetNotWithUpdate).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(200),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(300), BigNumber.from(400)],
          accRewardPerShare: poolInfoAfterSetWithUpdate.accRewardPerShare, // not updated
          lastRewardBlock: poolInfoAfterSetWithUpdate.lastRewardBlock, // not updated
          startBlock: poolInfoBeforeSet.startBlock,
          claimableInterval: poolInfoBeforeSet.claimableInterval
        })
      })
    })

    describe('charge', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenB.setBalance(wallet0.address, 400)
        await tokenB.approve(farming.address, constants.MaxUint256, overrides)
        await tokenC.setBalance(wallet0.address, 400)
        await tokenC.approve(farming.address, constants.MaxUint256, overrides)
      })

      it('fails for different amount length', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
        await expect(farming.charge(0, [200])).to.be.revertedWith('INVALID_AMOUNTS')
      })

      it('successful charge and check balance', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
        await expect(farming.charge(0, [200, 400]))
          .to.emit(farming, 'Charged')
          .withArgs(0, [tokenB.address, tokenC.address], [200, 400])
        expect(await tokenB.balanceOf(farming.address)).to.eq(BigNumber.from(200))
        expect(await tokenC.balanceOf(farming.address)).to.eq(BigNumber.from(400))
        expect(await farming.getRemaingRewards(0)).to.deep.eq(
          [BigNumber.from(200), BigNumber.from(400)]
        )
      })
    })

    describe('updatePool', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenB.setBalance(wallet0.address, 1000)
        await tokenB.approve(farming.address, constants.MaxUint256, overrides)
        await tokenC.setBalance(wallet0.address, 1000)
        await tokenC.approve(farming.address, constants.MaxUint256, overrides)
      })

      it('should not update anything if blockNumber less than lastRewardBlock', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 79
        await Time.advanceBlockTo(85)
        await farming.updatePool(0)
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfo).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(0),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(100), BigNumber.from(200)],
          accRewardPerShare: [BigNumber.from(0), BigNumber.from(0)],
          lastRewardBlock: BigNumber.from(90),
          startBlock: BigNumber.from(90),
          claimableInterval: BigNumber.from(10)
        })
      })

      it('only update lastRewardBlock if farmingSupply is zero', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 95
        await farming.updatePool(0)
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfo).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(0),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(100), BigNumber.from(200)],
          accRewardPerShare: [BigNumber.from(0), BigNumber.from(0)],
          lastRewardBlock: BigNumber.from(96), // 95 + 1
          startBlock: BigNumber.from(90),
          claimableInterval: BigNumber.from(10)
        })
      })

      it('update accRewardPerShare if farmingSupply larger than zero', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 105
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await farming.stake(0, tokenA.address, 400)
        await farming.updatePool(0)
        // current BlockNumber: 109
        const poolInfoFirstUpdate = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfoFirstUpdate).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(400),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(100), BigNumber.from(200)],
          // 1 * 100 * 10^12 / 400 = 250_000_000_000, 1 * 200 * 10^12 / 400 = 500_000_000_000
          accRewardPerShare: [BigNumber.from(250_000_000_000), BigNumber.from(500_000_000_000)],
          lastRewardBlock: BigNumber.from(109),
          startBlock: BigNumber.from(90),
          claimableInterval: BigNumber.from(10)
        })
        await Time.advanceBlockTo(111)
        await farming.updatePool(0)
        // current BlockNumber: 112
        const poolInfoSecondUpdate = parsePoolInfo(await farming.getPoolInfo(0))
        expect(poolInfoSecondUpdate).to.deep.eq({
          farmingToken: tokenA.address,
          amount: BigNumber.from(400),
          rewardTokens: [tokenB.address, tokenC.address],
          rewardPerBlock: [BigNumber.from(100), BigNumber.from(200)],
          // 250_000_000_000 + 3 * 100 * 10^12 / 400 = 1_000_000_000_000, 
          // 500_000_000_000 + 3 * 200 * 10^12 / 400 = 2_000_000_000_000
          accRewardPerShare: [BigNumber.from(1_000_000_000_000), BigNumber.from(2_000_000_000_000)],
          lastRewardBlock: BigNumber.from(112),
          startBlock: BigNumber.from(90),
          claimableInterval: BigNumber.from(10)
        })
      })
    })
  }),

    describe('stake', () => {
      it('fails for wrong farimgToken address', async () => {
        const farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256)
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        await expect(farming.stake(0, tokenB.address, 200)).to.be.revertedWith('FARMING_TOKEN_SAFETY_CHECK')
      })

      describe('one account', () => {
        let farming: Contract
        beforeEach('deploy', async () => {
          farming = await deployContract(wallet0, Farming, [], overrides)
          await tokenA.setBalance(wallet0.address, 1000)
          await tokenA.approve(farming.address, constants.MaxUint256, overrides)
          await tokenB.setBalance(farming.address, 10000)
          await tokenC.setBalance(farming.address, 20000)
        })

        it('init userInfo when first stake', async () => {
          await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
          const userInfoBeforeStake = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
          expect(userInfoBeforeStake).to.deep.eq({
            amount: BigNumber.from(0),
            rewardDebt: [],
            pending: [],
            nextClaimableBlock: BigNumber.from(0)
          })
          // current BlockNumber: 126
          await expect(farming.stake(0, tokenA.address, 200))
            .to.be.emit(farming, 'Stake')
            .withArgs(wallet0.address, 0, 200)
          const userInfoAfterStake = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
          const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
          const expectRewardDebt = poolInfo.accRewardPerShare.map(
            share => share.mul(BigNumber.from(200)).div(1e12)
          )
          expect(userInfoAfterStake).to.deep.eq({
            amount: BigNumber.from(200),
            rewardDebt: expectRewardDebt,
            pending: [BigNumber.from(0), BigNumber.from(0)],
            // (126 - 90 / 10 + 1) * 10 + 90 = 130
            nextClaimableBlock: BigNumber.from(130)
          })
        })

        it('correctly update pending and rewardDebt', async () => {
          await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
          // current BlockNumber: 136
          await Time.advanceBlockTo(140)
          await farming.stake(0, tokenA.address, 300)
          const userInfoFirstStake = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
          const poolInfoFirstStake = parsePoolInfo(await farming.getPoolInfo(0))
          const expectRewardDebtAfterFirstStake = poolInfoFirstStake.accRewardPerShare.map(
            share => share.mul(BigNumber.from(300)).div(1e12)
          )
          expect(userInfoFirstStake).to.deep.eq({
            amount: BigNumber.from(300),
            rewardDebt: expectRewardDebtAfterFirstStake,
            pending: [BigNumber.from(0), BigNumber.from(0)],
            // (141 - 90 / 10 + 1) * 10 + 90 = 150
            nextClaimableBlock: BigNumber.from(150)
          })
          // current BlockNumber: 141
          await farming.stake(0, tokenA.address, 400)
          const userInfoSecondStake = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
          const poolInfoSecondStake = parsePoolInfo(await farming.getPoolInfo(0))
          // [(100 * 10^12) / 300, (200 * 10^12) / 300] = [333_333_333_333, 666_666_666_666]
          expect(poolInfoSecondStake.accRewardPerShare)
            .to.be.deep.eq([BigNumber.from(333_333_333_333), BigNumber.from(666_666_666_666)])
          const expectRewardDebtAfterSecondStake = poolInfoSecondStake.accRewardPerShare.map(
            share => share.mul(BigNumber.from(700)).div(1e12)
          )
          const expectPendingAfterSecondStake = poolInfoSecondStake.accRewardPerShare.map(
            (share, i) => BigNumber.from(300).mul(share).div(1e12).sub(expectRewardDebtAfterFirstStake[i])
          )
          // only one person should take all rewards: (142 - 141) * [100, 200] => [99, 199]
          expect(userInfoSecondStake.pending)
            .to.be.deep.eq([BigNumber.from(99), BigNumber.from(199)])
          expect(userInfoSecondStake).to.deep.eq({
            amount: BigNumber.from(700),
            rewardDebt: expectRewardDebtAfterSecondStake,
            pending: expectPendingAfterSecondStake,
            nextClaimableBlock: BigNumber.from(150)
          })
        })
      })

      describe('two accounts', () => {
        let farming: Contract
        beforeEach('deploy', async () => {
          farming = await deployContract(wallet0, Farming, [], overrides)
          await tokenA.setBalance(wallet0.address, 1000)
          await tokenA.approve(farming.address, constants.MaxUint256, overrides)
          await tokenA.setBalance(wallet1.address, 1000)
          await tokenA.connect(wallet1).approve(farming.address, constants.MaxUint256, overrides)
          await tokenB.setBalance(farming.address, 10000)
          await tokenC.setBalance(farming.address, 20000)
        })

        it('one account stakes once and another stakes continuously', async () => {
          await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
          // current BlockNumber: 153
          await farming.stake(0, tokenA.address, 200)
          await Time.advanceBlockTo(160)
          await farming.connect(wallet1).stake(0, tokenA.address, 200)
          const pending0Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          // 100 * 7 = 700, 200 * 7 = 1400
          expect(pending0Wallet0).to.deep.eq([BigNumber.from(700), BigNumber.from(1400)])
          await Time.advanceBlockTo(163)
          const pending1Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          const pending1Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
          // 700 + 50 * 2 = 800, 1400 + 100 * 2 = 1600
          expect(pending1Wallet0).to.deep.eq([BigNumber.from(800), BigNumber.from(1600)])
          // 50 * 2 = 100, 100 * 2 = 200
          expect(pending1Wallet1).to.deep.eq([BigNumber.from(100), BigNumber.from(200)])
          await farming.connect(wallet1).stake(0, tokenA.address, 400)
          await Time.advanceBlockTo(167)
          const pending2Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          const pending2Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
          // 800 + 50 * 1 + 25 * 3 = 925, 1600 + 100 * 1 + 50 * 3 = 1850
          expect(pending2Wallet0).to.deep.eq([BigNumber.from(925), BigNumber.from(1850)])
          // 100 + 50 * 1 + 75 * 3 = 375, 200 + 100 * 1 + 150 * 3 = 750
          expect(pending2Wallet1).to.deep.eq([BigNumber.from(375), BigNumber.from(750)])
        })

        it('two accounts stake continuously', async () => {
          await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
          // current BlockNumber: 178
          await farming.stake(0, tokenA.address, 200)
          await Time.advanceBlockTo(185)
          await farming.connect(wallet1).stake(0, tokenA.address, 400)
          const pending0Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          // 100 * 7 = 700, 200 * 7 = 1400
          expect(pending0Wallet0).to.deep.eq([BigNumber.from(700), BigNumber.from(1400)])
          await Time.advanceBlockTo(190)
          const pending1Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          const pending1Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
          // 700 + 33.3 * 4 = 833, 1400 + 66.6 * 4 = 1666
          expect(pending1Wallet0).to.deep.eq([BigNumber.from(833), BigNumber.from(1666)])
          // 66.6 * 4 = 266, 133.28 * 4 = 533
          expect(pending1Wallet1).to.deep.eq([BigNumber.from(266), BigNumber.from(533)])
          await farming.stake(0, tokenA.address, 200) // [400, 400]
          await Time.advanceBlockTo(195)
          await farming.connect(wallet1).stake(0, tokenA.address, 200) // [400, 600]
          await Time.advanceBlockTo(200)
          const pending2Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
          const pending2Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
          // 833 + 33.3 * 1 + 50 * 5 + 40 * 4 = 1276, 1666.6 + 66.6 * 1 + 100 * 5 + 80 * 4 = 2553
          expect(pending2Wallet0).to.deep.eq([BigNumber.from(1276), BigNumber.from(2553)])
          // 266 + 66.6 * 1 + 50 * 5 + 60 * 4 = 823, 533 + 133.28 * 1 + 100 * 5 + 120 * 4 = 1646
          expect(pending2Wallet1).to.deep.eq([BigNumber.from(823), BigNumber.from(1646)])
        })
      })
    })

  describe('redeem', () => {
    it('fails for wrong farimgToken address', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenA.setBalance(wallet0.address, 1000)
      await tokenA.approve(farming.address, constants.MaxUint256)
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
      await expect(farming.redeem(0, tokenB.address, 200)).to.be.revertedWith('FARMING_TOKEN_SAFETY_CHECK')
    })

    it('fails for amount larger than which you staked', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenA.setBalance(wallet0.address, 1000)
      await tokenA.approve(farming.address, constants.MaxUint256)
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
      await farming.stake(0, tokenA.address, 200)
      await expect(farming.redeem(0, tokenA.address, 201)).to.be.revertedWith('INSUFFICIENT_AMOUNT')
    })

    describe('one account', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await tokenB.setBalance(farming.address, 10000)
        await tokenC.setBalance(farming.address, 20000)
      })

      it('redeem all', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 224
        await farming.stake(0, tokenA.address, 200)
        await Time.advanceBlockTo(231)
        await expect(farming.redeem(0, tokenA.address, 200))
          .to.be.emit(farming, 'Redeem')
          .withArgs(wallet0.address, 0, 200)
        await Time.advanceBlockTo(235)
        const userInfo = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
        expect(userInfo).to.deep.eq({
          amount: BigNumber.from(0),
          rewardDebt: [BigNumber.from(0), BigNumber.from(0)],
          // 100 * 7 = 700, 200 * 7 = 1400
          pending: [BigNumber.from(700), BigNumber.from(1400)],
          nextClaimableBlock: BigNumber.from(230)
        })
      })

      it('redeem half of staked amount', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 244
        await farming.stake(0, tokenA.address, 200)
        await Time.advanceBlockTo(251)
        await farming.redeem(0, tokenA.address, 100)
        await Time.advanceBlockTo(255)
        const userInfo = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        const expectRewardDebt = poolInfo.accRewardPerShare.map(
          share => share.mul(BigNumber.from(100)).div(1e12)
        )
        expect(userInfo).to.deep.eq({
          amount: BigNumber.from(100),
          rewardDebt: expectRewardDebt,
          // 100 * 7 = 700, 200 * 7 = 1400
          pending: [BigNumber.from(700), BigNumber.from(1400)],
          nextClaimableBlock: BigNumber.from(250)
        })
        const pendingRewards = (await farming.pendingRewards(0, wallet0.address)).rewards
        // 100 * 10 = 1000, 200 * 10 = 2000
        expect(pendingRewards).to.deep.eq([BigNumber.from(1000), BigNumber.from(2000)])
      })

      it('correctly update when stake and redeem', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 264
        await farming.stake(0, tokenA.address, 200)
        await Time.advanceBlockTo(271)
        await farming.redeem(0, tokenA.address, 100)
        await Time.advanceBlockTo(275)
        await farming.stake(0, tokenA.address, 300)
        await Time.advanceBlockTo(281)
        const userInfo = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        const expectRewardDebt = poolInfo.accRewardPerShare.map(
          share => share.mul(BigNumber.from(400)).div(1e12)
        )
        expect(userInfo).to.deep.eq({
          amount: BigNumber.from(400),
          rewardDebt: expectRewardDebt,
          // 100 * 11 = 1100, 200 * 11 = 2200
          pending: [BigNumber.from(1100), BigNumber.from(2200)],
          nextClaimableBlock: BigNumber.from(270)
        })
        const pendingRewards = (await farming.pendingRewards(0, wallet0.address)).rewards
        // 100 * 16 = 1600, 200 * 16 = 3200
        expect(pendingRewards).to.deep.eq([BigNumber.from(1600), BigNumber.from(3200)])
      })
    })

    describe('two accounts', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await tokenA.setBalance(wallet1.address, 1000)
        await tokenA.connect(wallet1).approve(farming.address, constants.MaxUint256, overrides)
        await tokenB.setBalance(farming.address, 10000)
        await tokenC.setBalance(farming.address, 20000)
      })

      it('one account redeems', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 292
        await farming.stake(0, tokenA.address, 200)
        await farming.connect(wallet1).stake(0, tokenA.address, 300)
        await Time.advanceBlockTo(300)
        await farming.redeem(0, tokenA.address, 100)
        await Time.advanceBlockTo(305)
        const pending0Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
        const pending0Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
        // 100 + 40 * 7 + 25 * 4 = 480, 200 + 80 * 7 + 50 * 4 = 960
        expect(pending0Wallet0).to.deep.eq([BigNumber.from(480), BigNumber.from(960)])
        // 60 * 7 + 75 * 4 = 720, 120 * 7 + 150 * 4 = 1440
        expect(pending0Wallet1).to.deep.eq([BigNumber.from(720), BigNumber.from(1440)])
      })

      it('two accounts redeem', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 316
        await farming.stake(0, tokenA.address, 200)
        await farming.connect(wallet1).stake(0, tokenA.address, 300)
        await Time.advanceBlockTo(320)
        await farming.redeem(0, tokenA.address, 100)
        await Time.advanceBlockTo(325)
        await farming.connect(wallet1).redeem(0, tokenA.address, 200)
        await Time.advanceBlockTo(330)
        const pending0Wallet0 = (await farming.pendingRewards(0, wallet0.address)).rewards
        const pending0Wallet1 = (await farming.pendingRewards(0, wallet1.address)).rewards
        // 100 + 40 * 3 + 25 * 5 + 50 * 4 = 545, 200 + 80 * 3 + 50 * 5 + 100 * 4 = 1090
        expect(pending0Wallet0).to.deep.eq([BigNumber.from(545), BigNumber.from(1090)])
        // 60 * 3 + 75 * 5 + 50 * 4 = 755, 120 * 3 + 150 * 5 + 100 * 4 = 1510
        expect(pending0Wallet1).to.deep.eq([BigNumber.from(755), BigNumber.from(1510)])
      })
    })
  })

  describe('claim', () => {
    it('fails for current blockNumber less than nextClaimableBlock', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenA.setBalance(wallet0.address, 1000)
      await tokenA.approve(farming.address, constants.MaxUint256)
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
      await farming.stake(0, tokenA.address, 200)
      await expect(farming.claim(0)).to.be.revertedWith('NOT_CLAIMABLE')
    })

    describe('one account', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await tokenB.setBalance(farming.address, 10000)
        await tokenC.setBalance(farming.address, 20000)
      })

      it('claim and check', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 347
        await farming.stake(0, tokenA.address, 200)
        await Time.advanceBlockTo(350)
        const rewards0: BigNumber[] = (await farming.pendingRewards(0, wallet0.address)).rewards
        await farming.claim(0)
        expect(await tokenB.balanceOf(wallet0.address)).to.eq(rewards0[0].add(BigNumber.from(100)))
        expect(await tokenC.balanceOf(wallet0.address)).to.eq(rewards0[1].add(BigNumber.from(200)))
        await Time.advanceBlockTo(355)
        const userInfo = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
        const poolInfo = parsePoolInfo(await farming.getPoolInfo(0))
        const expectRewardDebt = poolInfo.accRewardPerShare.map(
          share => share.mul(BigNumber.from(200)).div(1e12)
        )
        expect(userInfo).to.deep.eq({
          amount: BigNumber.from(200),
          rewardDebt: expectRewardDebt,
          // clear pending
          pending: [BigNumber.from(0), BigNumber.from(0)],
          // next claimable block after 355
          nextClaimableBlock: BigNumber.from(360)
        })
        const rewards1: BigNumber[] = (await farming.pendingRewards(0, wallet0.address)).rewards
        // 100 * 4 = 400, 200 * 4 = 800
        expect(rewards1).to.deep.eq([BigNumber.from(400), BigNumber.from(800)])
      })
    })

    describe('two accounts', () => {
      let farming: Contract
      beforeEach('deploy', async () => {
        farming = await deployContract(wallet0, Farming, [], overrides)
        await tokenA.setBalance(wallet0.address, 1000)
        await tokenA.approve(farming.address, constants.MaxUint256, overrides)
        await tokenA.setBalance(wallet1.address, 1000)
        await tokenA.connect(wallet1).approve(farming.address, constants.MaxUint256, overrides)
        await tokenB.setBalance(farming.address, 10000)
        await tokenC.setBalance(farming.address, 20000)
      })

      it('two accounts claim and check', async () => {
        await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
        // current BlockNumber: 366
        await farming.stake(0, tokenA.address, 200)
        await farming.connect(wallet1).stake(0, tokenA.address, 300)
        await Time.advanceBlockTo(370)
        const rewards0Wallet0: BigNumber[] = (await farming.pendingRewards(0, wallet0.address)).rewards
        const rewards0Wallet1: BigNumber[] = (await farming.pendingRewards(0, wallet1.address)).rewards
        await farming.claim(0)
        await farming.connect(wallet1).claim(0)
        expect(await tokenB.balanceOf(wallet0.address)).to.eq(rewards0Wallet0[0].add(BigNumber.from(40)))
        expect(await tokenC.balanceOf(wallet0.address)).to.eq(rewards0Wallet0[1].add(BigNumber.from(80)))
        expect(await tokenB.balanceOf(wallet1.address)).to.eq(rewards0Wallet1[0].add(BigNumber.from(120)))
        expect(await tokenC.balanceOf(wallet1.address)).to.eq(rewards0Wallet1[1].add(BigNumber.from(240)))
        await Time.advanceBlockTo(375)
        const rewards1Wallet0: BigNumber[] = (await farming.pendingRewards(0, wallet0.address)).rewards
        const rewards1Wallet1: BigNumber[] = (await farming.pendingRewards(0, wallet1.address)).rewards
        // 40 * 4 = 160, 80 * 4 = 320
        expect(rewards1Wallet0).to.deep.eq([BigNumber.from(160), BigNumber.from(320)])
        // 60 * 3 = 180, 120 * 3 = 360
        expect(rewards1Wallet1).to.deep.eq([BigNumber.from(180), BigNumber.from(360)])
      })
    })
  })

  describe('emergencyWithdraw', () => {
    it('withdraw and reset userInfo', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenA.setBalance(wallet0.address, 1000)
      await tokenA.approve(farming.address, constants.MaxUint256)
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
      await farming.stake(0, tokenA.address, 200)
      await expect(farming.emergencyWithdraw(0))
        .to.be.emit(farming, 'EmergencyWithdraw')
        .withArgs(wallet0.address, 0, 200)
      expect(await tokenA.balanceOf(wallet0.address)).to.eq(BigNumber.from(1000))
      const userInfo = parseUserInfo(await farming.getUserInfo(0, wallet0.address))
      expect(userInfo).to.deep.eq({
        amount: BigNumber.from(0),
        rewardDebt: [BigNumber.from(0), BigNumber.from(0)],
        pending: [BigNumber.from(0), BigNumber.from(0)],
        nextClaimableBlock: BigNumber.from(0)
      })
    })

    it('one withdraw and another update correctly', async () => {
      const farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenA.setBalance(wallet0.address, 1000)
      await tokenA.approve(farming.address, constants.MaxUint256, overrides)
      await tokenA.setBalance(wallet1.address, 1000)
      await tokenA.connect(wallet1).approve(farming.address, constants.MaxUint256, overrides)
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 90, 10)
      // current BlockNumber: 393
      await farming.stake(0, tokenA.address, 200)
      await farming.connect(wallet1).stake(0, tokenA.address, 200)
      await farming.emergencyWithdraw(0)
      await Time.advanceBlockTo(400)
      const rewards = (await farming.pendingRewards(0, wallet1.address)).rewards
      // 50 * 2 + 100 * 4 = 500, 100 * 2 + 200 * 4 = 1000
      expect(rewards).to.deep.eq([BigNumber.from(500), BigNumber.from(1000)])
    })
  })

  describe('withdrawRewards', () => {
    let farming: Contract
    beforeEach('deploy', async () => {
      farming = await deployContract(wallet0, Farming, [], overrides)
      await tokenB.setBalance(wallet0.address, 400)
      await tokenB.approve(farming.address, constants.MaxUint256, overrides)
      await tokenC.setBalance(wallet0.address, 400)
      await tokenC.approve(farming.address, constants.MaxUint256, overrides)
    })

    it('fails for different amount length', async () => {
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
      await farming.charge(0, [100, 200])
      await expect(farming.withdrawRewards(0, [100])).to.be.revertedWith('INVALID_AMOUNTS')
    })

    it('fails for larger amount than remainingRewards', async () => {
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
      await farming.charge(0, [100, 200])
      await expect(farming.withdrawRewards(0, [100, 300])).to.be.revertedWith('INVALID_AMOUNT')
    })

    it('successful charge and check balance', async () => {
      await farming.add(tokenA.address, [tokenB.address, tokenC.address], [100, 200], 10, 10)
      await farming.charge(0, [200, 400])
      await tokenA.setBalance(wallet0.address, 400)
      await tokenA.approve(farming.address, constants.MaxUint256, overrides)
      await farming.stake(0, tokenA.address, 200)
      await farming.stake(0, tokenA.address, 200)
      await expect(farming.withdrawRewards(0, [50, 100]))
        .to.be.emit(farming, 'WithdrawRewards')
        .withArgs(0, [tokenB.address, tokenC.address], [50, 100])
      expect(await farming.getRemaingRewards(0)).to.deep.eq([BigNumber.from(50), BigNumber.from(100)])
      expect(await tokenB.balanceOf(farming.address)).to.eq(BigNumber.from(150))
      expect(await tokenC.balanceOf(farming.address)).to.eq(BigNumber.from(300))
    })
  })
})
