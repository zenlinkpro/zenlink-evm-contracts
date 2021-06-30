import { Contract, Wallet } from 'ethers'
import { providers } from 'ethers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import BasicToken from '../../build/BasicToken.json'
import Factory from '../../build/Factory.json'
import Pair from '../../build/Pair.json'
import Router from '../../build/Router.json'
import NativeCurrency from '../../build/NativeCurrency.json'

interface FactoryFixture {
  factory: Contract
}

const overrides = {
  gasLimit: 4100000
}

export async function factoryFixture([wallet]: Wallet[], _: providers.Web3Provider,): Promise<FactoryFixture> {
  const factory = await deployContract(wallet, Factory, [wallet.address], overrides)
  return { factory }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
}

export async function pairFixture([wallet]: Wallet[], provider: providers.Web3Provider): Promise<PairFixture> {
  const { factory } = await factoryFixture([wallet], provider)

  const tokenA = await deployContract(wallet, BasicToken, ["TokenA", "TA", expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(wallet, BasicToken, ["TokenB", "TB", expandTo18Decimals(10000)], overrides)

  await factory.createPair(tokenA.address, tokenB.address, overrides)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)

  const token0Address = (await pair.token0()).address
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  return { factory, token0, token1, pair }
}

interface RouterFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  factory: Contract
  router: Contract
  nativeCurrency: Contract
}

export async function routerFixture([wallet]: Wallet[], provider: providers.Web3Provider): Promise<RouterFixture> {
  const { factory } = await factoryFixture([wallet], provider)

  const nativeCurrency = await deployContract(wallet, NativeCurrency, ["NativeCurrency", "Currency"], overrides)

  const router = await deployContract(wallet, Router, [factory.address, nativeCurrency.address], overrides)

  let token0 = await deployContract(wallet, BasicToken, ["TokenA", "TA", expandTo18Decimals(10000)], overrides)
  let token1 = await deployContract(wallet, BasicToken, ["TokenB", "TB", expandTo18Decimals(10000)], overrides)

  return { token0, token1, factory, router, nativeCurrency }
}