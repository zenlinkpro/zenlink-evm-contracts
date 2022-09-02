import { expect, use } from "chai";
import { Contract } from "ethers";
import { MockProvider, solidity } from "ethereum-waffle";
import { createTimeMachine } from "./shared/time";
import { deployGaugeFixture } from "./shared/governance";

use(solidity);

const overrides = {
  gasLimit: 4100000
}

const T0PoolId = 0
const T1PoolId = 1
const Hour = 3600

let voteDuraton = Hour * 4
let voteSetWindow = Hour

describe('Gauge', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, walletTo] = provider.getWallets();
  const time = createTimeMachine(provider);

  let gauge: Contract;
  let voteToken: Contract;
  let farming: Contract
  let farmingToken: Contract

  async function getCurBlockTimestamp() {
    const blockNumBefore = await provider.getBlockNumber();
    const blockBefore = await provider.getBlock(blockNumBefore);
    return blockBefore.timestamp;
  }

  beforeEach(async () => {
    let curTimestamp = await getCurBlockTimestamp()
    const fixture = await deployGaugeFixture(wallet, voteDuraton, voteSetWindow, curTimestamp + Hour)
    gauge = fixture.gauge
    voteToken = fixture.voteToken
    farming = fixture.farming
    farmingToken = fixture.farmingToken

    expect(await gauge.voteToken()).be.eq(voteToken.address)
    expect(await gauge.nextVotePeriodID()).be.eq(1)
    expect(await gauge.getCurrentPeriodId()).be.eq(0)
    await voteToken.transfer(walletTo.address, '20000000000000', overrides)

    await voteToken.approve(gauge.address, '50000000000000', overrides)
    await voteToken.connect(walletTo).approve(gauge.address, '50000000000000', overrides)

    await farming.add(farmingToken.address, [], [], 0, 0)
  })

  it('set votable pool', async () => {
    expect(await gauge.allPoolState(0, T0PoolId)).to.property("inherit").eq(false)
    expect(await gauge.allPoolState(0, T0PoolId)).to.property("votable").eq(false)

    await expect(gauge.connect(walletTo).setVotablePools([T0PoolId])).to.be.reverted
    expect(await gauge.allPoolState(0, T0PoolId)).to.property("votable").eq(false)

    await expect(gauge.setVotablePools([T0PoolId, T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId, T1PoolId])

    expect(await gauge.allPoolState(0, T0PoolId)).to.property("votable").eq(true)
    expect(await gauge.allPoolState(0, T1PoolId)).to.property("votable").eq(true)
  })

  it('set nonVotable pool', async () => {
    await expect(gauge.setVotablePools([T0PoolId, T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId, T1PoolId])
    expect(await gauge.allPoolState(0, T0PoolId)).to.property("votable").eq(true)
    expect(await gauge.allPoolState(0, T1PoolId)).to.property("votable").eq(true)

    await expect(gauge.connect(walletTo).setVotablePools([T0PoolId, T1PoolId])).to.be.reverted

    await expect(gauge.setNonVotablePools([T0PoolId, T1PoolId])).to.emit(gauge, "SetNonVotablePools").withArgs(0, [T0PoolId, T1PoolId])

    expect(await gauge.allPoolState(0, T0PoolId)).to.property("votable").eq(false)
    expect(await gauge.allPoolState(0, T1PoolId)).to.property("votable").eq(false)
  })

  it('set stable pool', async () => {
    let poolIds = [1, 2, 5]
    for (let i = 0; i < 10; i++) {
      await farming.add(farmingToken.address, [], [], 0, 0)
    }

    await gauge.setStablePools(poolIds)

    for (let i = 0; i < poolIds.length; i++) {
      expect(await gauge.getPoolInfo(poolIds[i])).to.property("stable").eq(true)
    }

    expect(await gauge.getPoolInfo(3)).to.property("stable").eq(false)

    poolIds = [1, 2, 5]
    await gauge.setNonStablePools(poolIds)
    for (let i = 0; i < poolIds.length; i++) {
      expect(await gauge.getPoolInfo(poolIds[i])).to.property("stable").eq(false)
    }
  })

  it('update vote period', async () => {
    let period0 = await gauge.votePeriods(0)

    // period0 not start, updateVotePeriod do nothing
    await gauge.updateVotePeriod()

    // in period0, updateVotePeriod do nothing
    let timestamp = period0.start.toNumber() + Hour
    time.setAndMine(timestamp)

    await gauge.updateVotePeriod()

    // after period0, update vote period success
    timestamp = period0.end.toNumber() + (voteSetWindow / 2)
    time.setAndMine(timestamp)

    let nextPeriodStart = period0.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton
    await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)

    // after period1.end + voteSetWindow, period2.start = block.Timestamp
    let period1 = await gauge.votePeriods(1)
    timestamp = period1.end.toNumber() + voteSetWindow
    time.setAndMine(timestamp)

    await gauge.updateVotePeriod()

    expect(await gauge.getCurrentPeriodId()).to.eq(2)
    let period2 = await gauge.votePeriods(2)
    let currentTimestamp = await getCurBlockTimestamp()
    expect(period2.start.toNumber()).to.eq(currentTimestamp)
    expect(period2.end.toNumber()).to.eq(currentTimestamp + voteDuraton)
  })

  it('update vote period paramater', async () => {
    // update vote duration at period 0, effective in period 1.
    let newVoteDuration = voteDuraton - Hour
    let newVoteSetWindow = voteSetWindow + Hour
    let period0 = await gauge.votePeriods(0)
    await expect(gauge.updateVoteDuration(newVoteDuration)).to.emit(gauge, "UpdateVoteDuration").withArgs(0, newVoteDuration)
    await expect(gauge.updateVoteSetWindow(newVoteSetWindow)).to.emit(gauge, "UpdateVoteSetWindow").withArgs(0, newVoteSetWindow)
    let period0AfterUpdate = await gauge.votePeriods(0)
    expect(period0AfterUpdate.start).to.eq(period0.start)
    expect(period0AfterUpdate.end).to.eq(period0.end)

    let timestamp = period0.start.toNumber() + newVoteDuration + 10
    time.setAndMine(timestamp)
    await gauge.updateVotePeriod()

    timestamp = period0.end.toNumber() + 10
    time.setAndMine(timestamp)
    let nextPeriodStart = period0.end.toNumber() + newVoteSetWindow
    let nextPeriodEnd = nextPeriodStart + newVoteDuration

    await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
    let period1 = await gauge.votePeriods(1)
    expect(period1.start.toNumber()).eq(nextPeriodStart)
    expect(period1.end.toNumber()).eq(nextPeriodEnd)
  })

  it('set nonVotable/votable pool', async () => {
    await expect(gauge.vote(T0PoolId, 10)).to.be.reverted
    await expect(gauge.vote(T1PoolId, 10)).to.be.reverted

    await expect(gauge.setVotablePools([T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T1PoolId])
    expect(await gauge.allPoolState(0, T1PoolId)).to.property("resetVotable").to.eq(true)

    // after period0,
    let period0 = await gauge.votePeriods(0)
    let timestamp = period0.end.toNumber() + 10

    time.setAndMine(timestamp)
    await expect(gauge.setVotablePools([T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(1, [T1PoolId])
    let poolState = await gauge.allPoolState(1, T1PoolId)
    expect(poolState.votable).eq(true)
    expect(poolState.resetVotable).eq(true)

    await expect(gauge.setNonVotablePools([T1PoolId])).to.emit(gauge, "SetNonVotablePools").withArgs(1, [T1PoolId])
    poolState = await gauge.allPoolState(1, T1PoolId)
    expect(poolState.votable).eq(false)
    expect(poolState.resetVotable).eq(true)

    // after period0.End + voteSetWindow
    timestamp = period0.end.toNumber() + voteSetWindow + 10
    time.setAndMine(timestamp)
    await expect(gauge.setVotablePools([T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(1, [T1PoolId])
    poolState = await gauge.allPoolState(1, T1PoolId)
    expect(poolState.votable).eq(true)
    expect(poolState.resetVotable).eq(true)
  })

  it('set votable not overwrite by update', async () => {
    // after period0,
    let period0 = await gauge.votePeriods(0)
    let timestamp = period0.end.toNumber() + 10
    time.setAndMine(timestamp)

    await expect(gauge.setVotablePools([T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(1, [T1PoolId])

    let nextPeriodStart = period0.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton
    await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
    await expect(gauge.updatePoolHistory(T1PoolId, 1)).to.emit(gauge, "UpdatePoolHistory").withArgs(T1PoolId, 1, 0, 1, 0)

    let poolState = await gauge.allPoolState(1, T1PoolId)
    expect(poolState.votable).eq(true)
    expect(poolState.resetVotable).eq(true)
  })

  function calculateScore(curTimestamp: number, amount: number, period: any) {
    return Math.floor(amount * (period.end.toNumber() - curTimestamp) / (period.end.toNumber() - period.start.toNumber()))
  }

  it('basic vote', async () => {
    // vote before period0 start
    await expect(gauge.vote(T0PoolId, 10000000000)).to.be.reverted
    await expect(gauge.setVotablePools([T0PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId])
    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)

    // vote after period0 start
    let period = await gauge.votePeriods(0)
    let timestamp = period.start.toNumber() + Hour * 2
    time.setAndMine(timestamp)
    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    let poolState = await gauge.allPoolState(0, T0PoolId)

    let curScore = 10000000000 + calculateScore(await getCurBlockTimestamp(), 10000000000, period)
    expect(poolState.score).eq(curScore)

    // vote after period0 end
    timestamp = period.end.toNumber() + 10
    time.setAndMine(timestamp)

    let nextPeriodStart = period.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton

    await expect(gauge.vote(T1PoolId, 10000000000)).to.be.reverted

    await expect(gauge.vote(T0PoolId, 10000000000))
      .to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
      .to.emit(gauge, "Vote").withArgs(wallet.address, 1, T0PoolId, 10000000000)
      .to.emit(gauge, "InheritPool").withArgs(T0PoolId, 1, 0, 20000000000, true)

    poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(curScore)

    let poolStatePeriod1 = await gauge.allPoolState(1, T0PoolId)
    expect(poolStatePeriod1.score).eq(30000000000)
  })

  it('update pool', async () => {
    await expect(gauge.setVotablePools([T0PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId])
    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    let poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(10000000000)

    for (let i = 1; i <= 5; i++) {
      let curPeriod = await gauge.votePeriods(i - 1)
      let nextPeriodStart = curPeriod.end.toNumber() + voteSetWindow
      let nextPeriodEnd = nextPeriodStart + voteDuraton
      let timestamp = curPeriod.end.toNumber() + 10
      time.setAndMine(timestamp)
      await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(i, nextPeriodStart, nextPeriodEnd)
      expect(await gauge.getPoolInfo(T0PoolId)).to.property("score").eq(10000000000)
    }

    await expect(gauge.updatePoolHistory(T0PoolId, 2)).to.emit(gauge, 'UpdatePoolHistory').withArgs(T0PoolId, 5, 0, 2, 10000000000)
    for (let i = 2; i <= 2; i++) {
      let poolState = await gauge.allPoolState(i, T0PoolId)
      expect(poolState.score).eq(10000000000)
      expect(poolState.totalAmount).eq(10000000000)
      expect(poolState.inherit).eq(true)
      expect(poolState.votable).eq(true)
    }

    await expect(gauge.updatePoolHistory(T0PoolId, 4)).to.emit(gauge, 'UpdatePoolHistory').withArgs(T0PoolId, 5, 2, 4, 10000000000)
    for (let i = 2; i <= 4; i++) {
      let poolState = await gauge.allPoolState(i, T0PoolId)
      expect(poolState.score).eq(10000000000)
      expect(poolState.totalAmount).eq(10000000000)
      expect(poolState.inherit).eq(true)
      expect(poolState.votable).eq(true)
    }

    poolState = await gauge.allPoolState(5, T0PoolId)
    expect(poolState.score).eq(0)
    expect(poolState.totalAmount).eq(0)
    expect(poolState.inherit).eq(false)
    expect(poolState.votable).eq(false)
  })

  it('multi periods vote', async () => {
    await expect(gauge.setVotablePools([T0PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId])
    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    let poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(10000000000)

    for (let i = 1; i <= 2; i++) {
      let curPeriod = await gauge.votePeriods(i - 1)
      let nextPeriodStart = curPeriod.end.toNumber() + voteSetWindow
      let nextPeriodEnd = nextPeriodStart + voteDuraton
      let timestamp = curPeriod.end.toNumber() + 10
      time.setAndMine(timestamp)
      await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(i, nextPeriodStart, nextPeriodEnd)

      if ((i % 2) == 0) {
        // updatePool() should inherit the state of expired pool
        await gauge.updatePoolHistory(T0PoolId, i)
        let poolState = await gauge.allPoolState(2, T0PoolId)
        expect(poolState.score).eq(10000000000 + (i - 1) * 2000000000)
        expect(poolState.totalAmount).eq(10000000000 + (i - 1) * 2000000000)
        expect(poolState.inherit).eq(true)
        expect(poolState.votable).eq(true)
      }

      await expect(gauge.vote(T0PoolId, 2000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, i, T0PoolId, 2000000000)
      let poolState = await gauge.allPoolState(i, T0PoolId)

      expect(poolState.score).eq(10000000000 + i * 2000000000)
      expect(poolState.totalAmount).eq(10000000000 + i * 2000000000)
      expect(poolState.inherit).eq(true)
      expect(poolState.votable).eq(true)

      await expect(gauge.updatePoolHistory(T0PoolId, i))

      poolState = await gauge.allPoolState(i, T0PoolId)
      expect(poolState.score).eq(10000000000 + i * 2000000000)
      expect(poolState.totalAmount).eq(10000000000 + i * 2000000000)
      expect(poolState.inherit).eq(true)
      expect(poolState.votable).eq(true)
    }
  })

  it('cancel vote', async () => {
    await expect(gauge.setVotablePools([T0PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId])

    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    await expect(gauge.cancelVote(T0PoolId, 10000000000)).to.emit(gauge, "CancelVote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    let poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(0)
    expect(await gauge.userInfos(wallet.address, T0PoolId)).to.eq(0)
    expect(await voteToken.balanceOf(gauge.address)).to.eq(0)
    expect(await voteToken.balanceOf(wallet.address)).to.eq(20000000000000)

    // cancel vote in period0 
    let period = await gauge.votePeriods(0)
    let timestamp = period.start.toNumber() + Hour * 2
    time.setAndMine(timestamp)
    await expect(gauge.vote(T0PoolId, 10000000000)).to.emit(gauge, "Vote").withArgs(wallet.address, 0, T0PoolId, 10000000000)
    let addedScore = calculateScore(await getCurBlockTimestamp(), 10000000000, period)

    timestamp = period.start.toNumber() + Hour * 3
    time.setAndMine(timestamp)
    await expect(gauge.cancelVote(T0PoolId, 5000000000)).to.emit(gauge, "CancelVote").withArgs(wallet.address, 0, T0PoolId, 5000000000)
    let removedScore = calculateScore(await getCurBlockTimestamp(), 5000000000, period)

    poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(addedScore - removedScore)
    expect(poolState.totalAmount).eq(5000000000)
    expect(await gauge.userInfos(wallet.address, T0PoolId)).to.eq(5000000000)

    // cancel vote after period0 end
    timestamp = period.end.toNumber() + 10
    time.setAndMine(timestamp)

    let nextPeriodStart = period.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton

    await expect(gauge.cancelVote(T0PoolId, 2500000000))
      .to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
      .to.emit(gauge, "CancelVote").withArgs(wallet.address, 1, T0PoolId, 2500000000)

    poolState = await gauge.allPoolState(0, T0PoolId)
    expect(poolState.score).eq(addedScore - removedScore)
    expect(poolState.totalAmount).eq(5000000000)

    // updateVotePeriod do nothing
    expect(await gauge.getCurrentPeriodId()).to.eq(1)
    await gauge.updateVotePeriod()
    expect(await gauge.getCurrentPeriodId()).to.eq(1)

    await expect(gauge.cancelVote(T0PoolId, 1250000000)).to.emit(gauge, "CancelVote").withArgs(wallet.address, 1, T0PoolId, 1250000000)
    poolState = await gauge.allPoolState(1, T0PoolId)
    expect(poolState.score).eq(1250000000)
    expect(poolState.totalAmount).eq(1250000000)

    // check vote token balance
    expect(await gauge.userInfos(wallet.address, T0PoolId)).to.eq(1250000000)
    expect(await voteToken.balanceOf(gauge.address)).to.eq(1250000000)
    expect(await voteToken.balanceOf(wallet.address)).to.eq(20000000000000 - 1250000000)
  })

  it('batch vote', async () => {
    await expect(gauge.setVotablePools([T0PoolId, T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId, T1PoolId])
    let period = await gauge.votePeriods(0)
    let timestamp = period.start.toNumber() + Hour * 2
    time.setAndMine(timestamp)

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000])).to.be.reverted

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000, 5000000000]))
      .to.emit(gauge, "BatchVote").withArgs(wallet.address, 0, [T0PoolId, T1PoolId], [5000000000, 5000000000])

    let pool0AddedScore = calculateScore(await getCurBlockTimestamp(), 5000000000, period)

    let pool0State = await gauge.allPoolState(0, T0PoolId)
    expect(pool0State.score).to.eq(pool0AddedScore)
    expect(pool0State.totalAmount).to.eq(5000000000)

    timestamp = period.end.toNumber() + 10
    time.setAndMine(timestamp)

    let nextPeriodStart = period.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton
    await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
    expect(await gauge.getCurrentPeriodId()).to.eq(1)

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000, 2500000000]))
      .to.emit(gauge, "BatchVote").withArgs(wallet.address, 1, [T0PoolId, T1PoolId], [5000000000, 2500000000])

    pool0State = await gauge.allPoolState(1, T0PoolId)
    expect(pool0State.score).to.eq(10000000000)
    expect(pool0State.totalAmount).to.eq(10000000000)

    let pool1State = await gauge.allPoolState(1, T1PoolId)
    expect(pool1State.score).to.eq(7500000000)
    expect(pool1State.totalAmount).to.eq(7500000000)
  })

  it('batch cancel vote', async () => {
    await expect(gauge.setVotablePools([T0PoolId, T1PoolId])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId, T1PoolId])
    let period = await gauge.votePeriods(0)
    let timestamp = period.start.toNumber() + Hour * 2
    time.setAndMine(timestamp)

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000])).to.be.reverted

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000, 5000000000]))
      .to.emit(gauge, "BatchVote").withArgs(wallet.address, 0, [T0PoolId, T1PoolId], [5000000000, 5000000000])

    let pool0AddedScore = calculateScore(await getCurBlockTimestamp(), 5000000000, period)

    let pool0State = await gauge.allPoolState(0, T0PoolId)
    expect(pool0State.score).to.eq(pool0AddedScore)
    expect(pool0State.totalAmount).to.eq(5000000000)

    timestamp = period.start.toNumber() + Hour * 3
    time.setAndMine(timestamp)

    await expect(gauge.batchCancelVote([T0PoolId, T1PoolId], [2500000000, 1000000000]))
      .to.emit(gauge, "BatchCancelVote").withArgs(wallet.address, 0, [T0PoolId, T1PoolId], [2500000000, 1000000000])

    let pool0RemovedScore = calculateScore(await getCurBlockTimestamp(), 2500000000, period)

    pool0State = await gauge.allPoolState(0, T0PoolId)
    expect(pool0State.score).to.eq(pool0AddedScore - pool0RemovedScore)
    expect(pool0State.totalAmount).to.eq(2500000000)

    timestamp = period.end.toNumber() + 10
    time.setAndMine(timestamp)

    let nextPeriodStart = period.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton
    await expect(gauge.updateVotePeriod()).to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)
    expect(await gauge.getCurrentPeriodId()).to.eq(1)

    await expect(gauge.batchCancelVote([T0PoolId, T1PoolId], [2500000000, 2100000000]))
      .to.emit(gauge, "BatchCancelVote").withArgs(wallet.address, 1, [T0PoolId, T1PoolId], [2500000000, 2100000000])

    pool0State = await gauge.allPoolState(1, T0PoolId)
    expect(pool0State.score).to.eq(0)
    expect(pool0State.totalAmount).to.eq(0)

    let pool1State = await gauge.allPoolState(1, T1PoolId)
    expect(pool1State.score).to.eq(1900000000)
    expect(pool1State.totalAmount).to.eq(1900000000)
  })

  it('migrate', async () => {
    await expect(gauge.setVotablePools([T0PoolId, T1PoolId, 2, 3])).to.emit(gauge, "SetVotablePools").withArgs(0, [T0PoolId, T1PoolId, 2, 3])

    await expect(gauge.batchVote([T0PoolId, T1PoolId], [5000000000, 4000000000]))
      .to.emit(gauge, "BatchVote").withArgs(wallet.address, 0, [T0PoolId, T1PoolId], [5000000000, 4000000000])

    await expect(gauge.migrateVote([T0PoolId, T1PoolId], [5000000000, 4000000000], [2, 3], [5000000000, 3000000000]))
      .to.be.reverted

    // before period start   
    await expect(gauge.migrateVote([T0PoolId, T1PoolId], [5000000000, 4000000000], [2, 3], [4000000000, 5000000000]))
      .to.emit(gauge, "MigrateVote").withArgs(wallet.address, 0, [T0PoolId, T1PoolId], [5000000000, 4000000000], [2, 3], [4000000000, 5000000000])

    let pool0State = await gauge.allPoolState(0, T0PoolId)
    expect(pool0State.score).to.eq(0)
    expect(pool0State.totalAmount).to.eq(0)


    let pool1State = await gauge.allPoolState(0, T1PoolId)
    expect(pool1State.score).to.eq(0)
    expect(pool1State.totalAmount).to.eq(0)

    let pool2State = await gauge.allPoolState(0, 2)
    expect(pool2State.score).to.eq(4000000000)
    expect(pool2State.totalAmount).to.eq(4000000000)

    let pool3State = await gauge.allPoolState(0, 3)
    expect(pool3State.score).to.eq(5000000000)
    expect(pool3State.totalAmount).to.eq(5000000000)

    let period = await gauge.votePeriods(0)
    let timestamp = period.start.toNumber() + Hour * 2
    time.setAndMine(timestamp)

    await expect(gauge.migrateVote([2, 3], [1000000000, 2000000000], [T1PoolId, T0PoolId], [500000000, 2500000000]))
      .to.emit(gauge, "MigrateVote").withArgs(wallet.address, 0, [2, 3], [1000000000, 2000000000], [T1PoolId, T0PoolId], [500000000, 2500000000])
    let pool2RemovedScore = calculateScore(await getCurBlockTimestamp(), 1000000000, period)
    let pool3RemovedScore = calculateScore(await getCurBlockTimestamp(), 2000000000, period)
    let pool0AddedScore = calculateScore(await getCurBlockTimestamp(), 2500000000, period)
    let pool1AddedScore = calculateScore(await getCurBlockTimestamp(), 500000000, period)

    pool0State = await gauge.allPoolState(0, T0PoolId)
    expect(pool0State.score).to.eq(pool0AddedScore)
    expect(pool0State.totalAmount).to.eq(2500000000)

    pool1State = await gauge.allPoolState(0, T1PoolId)
    expect(pool1State.score).to.eq(pool1AddedScore)
    expect(pool1State.totalAmount).to.eq(500000000)

    pool2State = await gauge.allPoolState(0, 2)
    expect(pool2State.score).to.eq(4000000000 - pool2RemovedScore)
    expect(pool2State.totalAmount).to.eq(4000000000 - 1000000000)

    pool3State = await gauge.allPoolState(0, 3)
    expect(pool3State.score).to.eq(5000000000 - pool3RemovedScore)
    expect(pool3State.totalAmount).to.eq(5000000000 - 2000000000)

    timestamp = period.end.toNumber() + 10
    time.setAndMine(timestamp)

    let nextPeriodStart = period.end.toNumber() + voteSetWindow
    let nextPeriodEnd = nextPeriodStart + voteDuraton
    await expect(gauge.migrateVote([2, 3], [500000000, 200000000], [T1PoolId, T0PoolId], [200000000, 500000000]))
      .to.emit(gauge, "UpdateVotePeriod").withArgs(1, nextPeriodStart, nextPeriodEnd)

    // updateVotePeriod do nothing
    await gauge.updateVotePeriod()
    expect(await gauge.getCurrentPeriodId()).to.eq(1)

    await expect(gauge.migrateVote([2, 3], [500000000, 200000000], [T1PoolId, T0PoolId], [200000000, 500000000]))
      .to.emit(gauge, "MigrateVote").withArgs(wallet.address, 1, [2, 3], [500000000, 200000000], [T1PoolId, T0PoolId], [200000000, 500000000])

    pool0State = await gauge.allPoolState(1, T0PoolId)
    expect(pool0State.score).to.eq(2500000000 + 500000000 * 2)
    expect(pool0State.totalAmount).to.eq(2500000000 + 500000000 * 2)

    pool1State = await gauge.allPoolState(1, T1PoolId)
    expect(pool1State.score).to.eq(500000000 + 200000000 * 2)
    expect(pool1State.totalAmount).to.eq(500000000 + 200000000 * 2)

    pool2State = await gauge.allPoolState(1, 2)
    expect(pool2State.score).to.eq(3000000000 - 500000000 * 2)
    expect(pool2State.totalAmount).to.eq(3000000000 - 500000000 * 2)

    pool3State = await gauge.allPoolState(1, 3)
    expect(pool3State.score).to.eq(5000000000 - 2000000000 - 200000000 * 2)
    expect(pool3State.totalAmount).to.eq(5000000000 - 2000000000 - 200000000 * 2)

    expect(await voteToken.balanceOf(wallet.address)).to.eq(20000000000000 - 5000000000 - 4000000000)
  })
})  
