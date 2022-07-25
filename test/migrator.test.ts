import chai, { expect } from 'chai'
import { createFixtureLoader, MockProvider, solidity } from "ethereum-waffle"
import { constants, Contract } from 'ethers'
import { migratorFixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

const { MaxUint256, AddressZero } = constants

describe('Migrator', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })

  const [wallet, wallet02] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let token0: Contract
  let token1: Contract
  let router01: Contract
  let router02: Contract
  let migrator: Contract
  let pair: Contract
  let newPair: Contract

  beforeEach(async function() {
    const fixture = await loadFixture(migratorFixture)
    token0 = fixture.token0
    token1 = fixture.token1
    router01 = fixture.router01
    router02 = fixture.router02
    migrator = fixture.migrator
    pair = fixture.pair
    newPair = fixture.newPair
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
      migrator.migrate(pair.address, 0, 0, wallet02.address, MaxUint256, overrides)
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
