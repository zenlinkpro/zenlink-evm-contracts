import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { constants } from 'ethers'
import { deployments } from 'hardhat'
import { BasicToken, Migrator, Pair, Router } from '../types'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

const { MaxUint256, AddressZero } = constants

describe('Migrator', () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let wallet02: SignerWithAddress

  let token0: BasicToken
  let token1: BasicToken
  let router01: Router
  let router02: Router
  let migrator: Migrator
  let pair: Pair
  let newPair: Pair

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
        ;[wallet, wallet02] = signers


      const basicTokenFactory = await ethers.getContractFactory('BasicToken')
      const tokenA = (await basicTokenFactory.deploy("tokenA", "tokenA", 18, expandTo18Decimals(10000))) as BasicToken
      const tokenB = (await basicTokenFactory.deploy("tokenB", "tokenB", 18, expandTo18Decimals(10000))) as BasicToken

      const wnativeFactory = await ethers.getContractFactory('NativeCurrency')
      const wnative = await wnativeFactory.deploy("wnative", "wnative")

      const factoryFactory = await ethers.getContractFactory('Factory')
      const factoryV1 = await factoryFactory.deploy(wallet.address)
      const factoryV2 = await factoryFactory.deploy(wallet.address)

      const routerFactory = await ethers.getContractFactory('Router')
      router01 = (await routerFactory.deploy(factoryV1.address, wnative.address)) as Router
      router02 = (await routerFactory.deploy(factoryV2.address, wnative.address)) as Router

      const migratorFactory = await ethers.getContractFactory('Migrator')
      migrator = (await migratorFactory.deploy(factoryV1.address, router02.address, wnative.address)) as Migrator

      await factoryV1.createPair(tokenA.address, tokenB.address)
      const pairAddress = await factoryV1.getPair(tokenA.address, tokenB.address)
      pair = (await ethers.getContractAt('Pair', pairAddress)) as Pair

      const token0Address = await pair.token0()
      token0 = tokenA.address === token0Address ? tokenA : tokenB
      token1 = tokenA.address === token0Address ? tokenB : tokenA

      await factoryV2.createPair(tokenA.address, tokenB.address)
      const newPairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
      newPair = (await ethers.getContractAt('Pair', newPairAddress)) as Pair
    }
  )

  beforeEach(async function () {
    await setupTest()
  })

  it('migrate', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await token0.approve(router01.address, MaxUint256)
    await token1.approve(router01.address, MaxUint256)
    await router01.addLiquidity(
      token0.address,
      token1.address,
      token0Amount,
      token1Amount,
      0,
      0,
      wallet.address,
      MaxUint256
    )
    await pair.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    await expect(
      migrator.migrate(pair.address, 0, 0, wallet02.address, MaxUint256)
    )
      .to.emit(newPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, MINIMUM_LIQUIDITY)
      .to.emit(newPair, 'Transfer')
      .withArgs(AddressZero, wallet02.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(newPair, 'Sync')
      .withArgs(token0Amount, token1Amount)
      .to.emit(newPair, 'Mint')
      .withArgs(
        router02.address,
        token0Amount,
        token1Amount
      )
    expect(await newPair.balanceOf(wallet02.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })
})
