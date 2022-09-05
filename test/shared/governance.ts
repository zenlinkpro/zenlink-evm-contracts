import { Contract, Wallet } from 'ethers'
import { waffle } from "hardhat";
const { deployContract } = waffle;

import Gauge from '../../build/contracts/governance/Gauge.sol/Gauge.json'
import Farming from '../../build/contracts/periphery/Farming.sol/Farming.json'
import BasicToken from '../../build/contracts/test/BasicToken.sol/BasicToken.json'

const overrides = {
  gasLimit: 6100000
}

export interface gaugeFixture {
  voteToken: Contract
  gauge: Contract
  farming: Contract
  farmingToken: Contract
  farmingRewardToken: Contract
}

export async function deployGaugeFixture(wallet: Wallet, voteDuraton: number, voteSetWindow: number, start: number): Promise<gaugeFixture> {
  const farming = await deployContract(wallet, Farming, [], overrides)
  const voteToken = await deployContract(wallet, BasicToken, ["VoteToken", "VT", 10, '40000000000000'], overrides)

  const farmingToken = await deployContract(wallet, BasicToken, ["FarmingToken", "FT", 10, '40000000000000'], overrides)
  const farmingRewardToken = await deployContract(wallet, BasicToken, ["FarmingRewardToken", "FRT", 10, '40000000000000'], overrides)

  const gauge = await deployContract(wallet, Gauge, [farming.address, voteToken.address, voteDuraton, voteSetWindow, start], overrides)
  return { voteToken, gauge, farming, farmingToken, farmingRewardToken }
}
