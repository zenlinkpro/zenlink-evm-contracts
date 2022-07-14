import { Contract, Wallet } from 'ethers'
import { waffle } from "hardhat";
import { MockProvider } from "ethereum-waffle"
import { expandTo10Decimals, expandTo18Decimals } from './utilities'

import BasicToken from '../../build/contracts/test/BasicToken.sol/BasicToken.json'
import Factory from '../../build/contracts/core//Factory.sol/Factory.json'
import Pair from '../../build/contracts/core/Pair.sol/Pair.json'
import Router from '../../build/contracts/periphery/Router.sol/Router.json'
import NativeCurrency from '../../build/contracts/test/NativeCurrency.sol/NativeCurrency.json'
import Stake from '../../build/contracts/periphery/Stake.sol/Stake.json'
import Bootstrap from '../../build/contracts/periphery/Bootstrap.sol/Bootstrap.json'
import ZenlinkToken from '../../build/contracts/tokens/ZenlinkToken.sol/ZenlinkToken.json'
import Migrator from '../../build/contracts/periphery/Migrator.sol/Migrator.json'

const { deployContract } = waffle;

interface FactoryFixture {
  factory: Contract
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
}

interface RouterFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  factory: Contract
  router: Contract
  nativeCurrency: Contract
}

interface StakeFixture extends PairFixture {
  stake: Contract
  rewardToken: Contract
}

interface BootstrapFixture {
  factory: Contract
  token0: Contract
  token1: Contract
  bootstrap: Contract
}

interface ZenlinkTokenFixture {
  zenlinkToken: Contract
}

interface MigratorFixture {
  token0: Contract
  token1: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  migrator: Contract
  pair: Contract
  newPair: Contract
}

const overrides = {
  gasLimit: 6100000
}

export async function factoryFixture(wallet: Wallet): Promise<FactoryFixture> {
  const factory = await deployContract(wallet, Factory, [wallet.address], overrides)
  return { factory }
}

export async function pairFixture(wallet: Wallet): Promise<PairFixture> {
  const { factory } = await factoryFixture(wallet)

  const tokenA = await deployContract(wallet, BasicToken, ["TokenA", "TA", 18, '1549903311500105273839447'], overrides)
  const tokenB = await deployContract(wallet, BasicToken, ["TokenB", "TB", 18, '1403957892781062528318836'], overrides)

  await factory.createPair(tokenA.address, tokenB.address, overrides)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), wallet.provider).connect(wallet)

  const token0Address = (await pair.token0())
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  return { factory, token0, token1, pair }
}

export async function routerFixture(wallet: Wallet): Promise<RouterFixture> {
  const { factory } = await factoryFixture(wallet)

  const nativeCurrency = await deployContract(wallet, NativeCurrency, ["NativeCurrency", "Currency"], overrides)

  const router = await deployContract(wallet, Router, [factory.address, nativeCurrency.address], overrides)

  let token0 = await deployContract(wallet, BasicToken, ["TokenA", "TA", 18, '1549903311500105273839447'], overrides)
  let token1 = await deployContract(wallet, BasicToken, ["TokenB", "TB", 18, '1403957892781062528318836'], overrides)

  return { token0, token1, factory, router, nativeCurrency }
}

export async function StakeFixture(wallet: Wallet, stakeStartBlock: number, endStartBlock: number): Promise<StakeFixture> {
  const { factory, token0, token1, pair } = await pairFixture(wallet)
  let rewardToken = await deployContract(wallet, BasicToken, ["stake reward", "SR", 18, expandTo10Decimals(1)], overrides)
  let stake = await deployContract(wallet, Stake, [pair.address, rewardToken.address, stakeStartBlock, endStartBlock], overrides)

  return { factory, token0, token1, pair, stake, rewardToken }
}

export async function BootstrapFixture(wallet: Wallet, endBlock: number): Promise<BootstrapFixture> {
  const { factory } = await factoryFixture(wallet)
  const token0 = await deployContract(
    wallet,
    BasicToken,
    ["TokenA", "TA", 18, expandTo18Decimals(100000)],
    overrides
  )
  const token1 = await deployContract(
    wallet,
    BasicToken,
    ["TokenB", "TB", 18, expandTo18Decimals(100000)],
    overrides
  )
  const [token0Address, token1Address] = token0.address < token1.address
    ? [token0.address, token1.address]
    : [token1.address, token0.address]
  await factory.setBootstrap(token0Address, token1Address, wallet.address)
  const bootstrap = await deployContract(
    wallet,
    Bootstrap,
    [factory.address, token0Address, token1Address, 10000, 10000, 15000, 20000, endBlock],
    overrides
  )

  return { factory, token0, token1, bootstrap }
}

export async function ZenlinkTokenFixture(wallet: Wallet): Promise<ZenlinkTokenFixture> {
  const zenlinkToken = await deployContract(wallet, ZenlinkToken, ["ZLK", "zenlink token", 18, '30000000000000000000000000', '40000000000000000000000000'], overrides)
  return { zenlinkToken }
}

export async function migratorFixture([wallet]: Wallet[], provider: MockProvider): Promise<MigratorFixture> {
  const tokenA = await deployContract(wallet, BasicToken, ["tokenA", "tokenA", 18, expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(wallet, BasicToken, ["tokenB", "tokenB", 18, expandTo18Decimals(10000)], overrides)
  const wnative = await deployContract(wallet, NativeCurrency, ["wnative", "wnative"], overrides)

  const { factory: factoryV1 } = await factoryFixture(wallet)
  const { factory: factoryV2 } = await factoryFixture(wallet)

  const router01 = await deployContract(wallet, Router, [factoryV1.address, wnative.address], overrides)
  const router02 = await deployContract(wallet, Router, [factoryV2.address, wnative.address], overrides)
  const migrator = await deployContract(wallet, Migrator, [factoryV1.address, router02.address, wnative.address], overrides)

  await factoryV1.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV1.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(tokenA.address, tokenB.address)
  const newPairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const newPair = new Contract(newPairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    factoryV1,
    factoryV2,
    router01,
    router02,
    migrator,
    pair,
    newPair
  }
}
