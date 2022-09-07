import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, constants, BigNumber } from "ethers";
import { deployments } from "hardhat";
import { BasicToken, Factory, NativeCurrency, Router } from "../typechain-types";
import { getCreate2Address, expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'
import Pair from '../build/artifacts/contracts/core/Pair.sol/Pair.json'

describe('Router', () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress

  let factory: Factory;
  let token0: BasicToken;
  let token1: BasicToken;
  let router: Router;
  let WNativeCurrency: NativeCurrency;

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
      ;[wallet] = signers

      const factoryFactory = await ethers.getContractFactory('Factory')
      factory = (await factoryFactory.deploy(wallet.address)) as Factory

      const wnativeFactory = await ethers.getContractFactory('NativeCurrency')
      WNativeCurrency = (await wnativeFactory.deploy("NativeCurrency", "Currency")) as NativeCurrency

      const routerFactory = await ethers.getContractFactory('Router')
      router = (await routerFactory.deploy(factory.address, WNativeCurrency.address)) as Router

      const basicTokenFactory = await ethers.getContractFactory('BasicToken')
      token0 = (await basicTokenFactory.deploy("TokenA", "TA", 18, '1549903311500105273839447')) as BasicToken
      token1 = (await basicTokenFactory.deploy("TokenB", "TB", 18, '1403957892781062528318836')) as BasicToken
    }
  )

  beforeEach(async function () {
    await setupTest()
  })

  it('factory, WNativeCurrency', async () => {
    expect(await router.factory()).to.eq(factory.address)
    expect(await router.WNativeCurrency()).to.eq(WNativeCurrency.address)
  })

  it('addLiquidity', async () => {
    let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
    await expect(factory.createPair(token0.address, token1.address))
      .to.emit(factory, 'PairCreated')
      .withArgs(tokens[0].address, tokens[1].address, create2Address, BigNumber.from(1))

    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)

    let amounts = token0.address > token1.address ? [token1Amount, token0Amount] : [token0Amount, token1Amount]

    const expectedLiquidity = expandTo18Decimals(2)
    await token0.approve(router.address, constants.MaxUint256)
    await token1.approve(router.address, constants.MaxUint256)
    await expect(
      router.addLiquidity(
        tokens[0].address,
        tokens[1].address,
        amounts[0],
        amounts[1],
        0,
        0,
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(tokens[0], 'Transfer')
      .withArgs(wallet.address, create2Address, amounts[0])
      .to.emit(tokens[1], 'Transfer')
      .withArgs(wallet.address, create2Address, amounts[1])
      .to.emit(pair, 'Transfer')
      .withArgs(constants.AddressZero, wallet.address, MINIMUM_LIQUIDITY)
      .to.emit(pair, 'Transfer')
      .withArgs(constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Mint')
      .withArgs(router.address, amounts[0], amounts[1])

    expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity)
  })

  it('addLiquiditySingleToken', async () => {
    let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

    const token1Amount = '549903311500105273839447'
    const token0Amount = '403957892781062528318836'
    let amounts = token0.address > token1.address ? [token1Amount, token0Amount] : [token0Amount, token1Amount]

    await token0.approve(router.address, constants.MaxUint256)
    await token1.approve(router.address, constants.MaxUint256)

    await addLiquidityWithString(tokens[0], tokens[1], amounts[0], amounts[1])

    await router.addLiquiditySingleToken(
      [token0.address, token1.address],
      '100000000000000000000',
      '64552102673537973031',
      '50072014029053536754',
      '0',
      wallet.address,
      constants.MaxUint256,
    )
  })

  it('addLiquiditySingleNativeCurrency', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(1)
    const NativeCurrencyAmount = expandTo18Decimals(1)

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    await expect(factory.createPair(token0.address, WNativeCurrency.address))
      .to.emit(factory, 'PairCreated')
      .withArgs(
        token0.address > WNativeCurrency.address ? WNativeCurrency.address : token0.address,
        token0.address > WNativeCurrency.address ? token0.address : WNativeCurrency.address,
        create2Address,
        BigNumber.from(1))

    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)
    const pairToken0 = await pair.token0()

    await token0.approve(router.address, constants.MaxUint256)

    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      NativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: NativeCurrencyAmount })

    await expect(router.addLiquiditySingleNativeCurrency(
      [WNativeCurrency.address, token0.address],
      '49000000000',
      '50000000000',
      '0',
      wallet.address,
      constants.MaxUint256,
      { value: '100000000000' })
    )
      .to.emit(WNativeCurrency, 'Transfer')  // Deposit NativeCurrency
      .withArgs(constants.AddressZero, router.address, '49147444736')
      .to.emit(pair, "Swap")                 // Swap
      .withArgs(router.address,
        pairToken0 == token0.address ? 0 : 49147444736,
        pairToken0 == token0.address ? 49147444736 : 0,
        pairToken0 == token0.address ? 49000000000 : 0,
        pairToken0 == token0.address ? 0 : 49000000000,
        wallet.address
      )
      .to.emit(token0, 'Transfer')           // Transfer Token                          
      .withArgs(wallet.address, pair.address, '49000000000')
      .to.emit(WNativeCurrency, 'Transfer')  // Withdraw NativeCurrency
      .withArgs(router.address, pair.address, '49000004809')
      .to.emit(pair, 'Transfer')             // Mint Lp
      .withArgs(constants.AddressZero, wallet.address, '49000002400')
  })

  it('addLiquidityNativeCurrency', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(1)
    const NativeCurrencyAmount = expandTo18Decimals(4)
    const expectedLiquidity = expandTo18Decimals(2)

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    await expect(factory.createPair(token0.address, WNativeCurrency.address))
      .to.emit(factory, 'PairCreated')
      .withArgs(
        token0.address > WNativeCurrency.address ? WNativeCurrency.address : token0.address,
        token0.address > WNativeCurrency.address ? token0.address : WNativeCurrency.address,
        create2Address,
        BigNumber.from(1))

    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)
    const pairToken0 = await pair.token0()
    await token0.approve(router.address, constants.MaxUint256)

    await expect(
      router.addLiquidityNativeCurrency(
        token0.address,
        WNativeCurrencyPartnerAmount,
        WNativeCurrencyPartnerAmount,
        NativeCurrencyAmount,
        wallet.address,
        constants.MaxUint256,
        { value: NativeCurrencyAmount }
      )
    )
      .to.emit(pair, 'Transfer')
      .withArgs(constants.AddressZero, wallet.address, MINIMUM_LIQUIDITY)
      .to.emit(pair, 'Transfer')
      .withArgs(constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Mint')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? WNativeCurrencyPartnerAmount : NativeCurrencyAmount,
        pairToken0 === token0.address ? NativeCurrencyAmount : WNativeCurrencyPartnerAmount)
  })

  async function addLiquidity(token0: Contract, token1: Contract, token0Amount: BigNumber, token1Amount: BigNumber) {
    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
    await factory.createPair(token0.address, token1.address)

    await token0.transfer(create2Address, token0Amount)
    await token1.transfer(create2Address, token1Amount)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet);
    await pair.mint(wallet.address)
  }

  async function addLiquidityWithString(token0: Contract, token1: Contract, token0Amount: string, token1Amount: string) {
    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
    await factory.createPair(token0.address, token1.address)

    await token0.transfer(create2Address, token0Amount)
    await token1.transfer(create2Address, token1Amount)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet);
    await pair.mint(wallet.address)
  }

  it('removeLiquidity', async () => {
    let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    let amounts = token0.address > token1.address ? [token1Amount, token0Amount] : [token0Amount, token1Amount]

    await addLiquidity(tokens[0], tokens[1], amounts[0], amounts[1])

    const expectedLiquidity = expandTo18Decimals(2)
    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet);

    await pair.approve(router.address, constants.MaxUint256)
    await expect(
      router.removeLiquidity(
        tokens[0].address,
        tokens[1].address,
        expectedLiquidity,
        0,
        0,
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(pair, 'Transfer')
      .withArgs(wallet.address, pair.address, expectedLiquidity)
      .to.emit(tokens[0], 'Transfer')
      .withArgs(pair.address, wallet.address, amounts[0])
      .to.emit(tokens[1], 'Transfer')
      .withArgs(pair.address, wallet.address, amounts[1])
      .to.emit(pair, 'Burn')
      .withArgs(router.address, amounts[0], amounts[1], wallet.address)
  })

  it('removeLiquidityNativeCurrency', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(1)
    const WNativeCurrencyAmount = expandTo18Decimals(4)

    await token0.approve(router.address, constants.MaxUint256)

    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: WNativeCurrencyAmount }
    )

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    await pair.approve(router.address, constants.MaxUint256)
    const pairToken0 = await pair.token0()

    const expectedLiquidity = expandTo18Decimals(2)
    await expect(
      router.removeLiquidityNativeCurrency(
        token0.address,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        0,
        0,
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(pair, 'Transfer')
      .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Transfer')
      .withArgs(pair.address, constants.AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(WNativeCurrency, 'Transfer')
      .withArgs(pair.address, router.address, WNativeCurrencyAmount.sub(2000))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, router.address, WNativeCurrencyPartnerAmount.sub(500))
      .to.emit(token0, 'Transfer')
      .withArgs(router.address, wallet.address, WNativeCurrencyPartnerAmount.sub(500))
      .to.emit(pair, 'Burn')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? WNativeCurrencyPartnerAmount.sub(500) : WNativeCurrencyAmount.sub(2000),
        pairToken0 === token0.address ? WNativeCurrencyAmount.sub(2000) : WNativeCurrencyPartnerAmount.sub(500),
        router.address
      )

    expect(await pair.balanceOf(wallet.address)).to.eq(MINIMUM_LIQUIDITY)
    const totalSupplyWNativeCurrencyPartner = await token0.totalSupply()
    const totalSupplyWNativeCurrency = await WNativeCurrency.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyWNativeCurrencyPartner.sub(500))
    expect(await WNativeCurrency.balanceOf(wallet.address)).to.eq(totalSupplyWNativeCurrency.sub(2000))
  })

  it('swapExactTokensForTokens', async () => {
    let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from('1662497915624478906')

    await token0.approve(router.address, constants.MaxUint256)
    await token1.approve(router.address, constants.MaxUint256)

    await router.addLiquidity(
      tokens[0].address,
      tokens[1].address,
      token0Amount,
      token1Amount,
      0,
      0,
      wallet.address,
      constants.MaxUint256,
    )

    let pairAddress = await factory.getPair(token1.address, token0.address)
    const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), wallet)
    const pairToken0 = await pair.token0()

    await expect(
      router.swapExactTokensForTokens(
        swapAmount,
        0,
        [tokens[0].address, tokens[1].address],
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(tokens[0], 'Transfer')
      .withArgs(wallet.address, pairAddress, swapAmount)
      .to.emit(tokens[1], 'Transfer')
      .withArgs(pairAddress, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(router.address,
        pairToken0 == tokens[0].address ? swapAmount : 0,
        pairToken0 == tokens[0].address ? 0 : swapAmount,
        pairToken0 == tokens[0].address ? 0 : expectedOutputAmount,
        pairToken0 == tokens[0].address ? expectedOutputAmount : 0,
        wallet.address)
  })

  it('swapTokensForExactTokens', async () => {
    let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    const expectedSwapAmount = BigNumber.from('557227237267357629')
    const outputAmount = expandTo18Decimals(1)

    await token0.approve(router.address, constants.MaxUint256)
    await token1.approve(router.address, constants.MaxUint256)

    await router.addLiquidity(
      tokens[0].address,
      tokens[1].address,
      token0Amount,
      token1Amount,
      0,
      0,
      wallet.address,
      constants.MaxUint256,
    )

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [tokens[0].address, tokens[1].address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    await expect(
      router.swapTokensForExactTokens(
        outputAmount,
        constants.MaxUint256,
        [tokens[0].address, tokens[1].address],
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(tokens[0], 'Transfer')
      .withArgs(wallet.address, pair.address, expectedSwapAmount)
      .to.emit(tokens[1], 'Transfer')
      .withArgs(pair.address, wallet.address, outputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
  })

  it('swapExactNativeCurrencyForTokens', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(10)
    const WNativeCurrencyAmount = expandTo18Decimals(5)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from('1662497915624478906')

    await token0.approve(router.address, constants.MaxUint256)

    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: WNativeCurrencyAmount }
    )

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    const pairToken0 = await pair.token0()
    await expect(
      router.swapExactNativeCurrencyForTokens(0, [WNativeCurrency.address, token0.address], wallet.address, constants.MaxUint256, {
        value: swapAmount
      })
    )
      .to.emit(WNativeCurrency, 'Transfer')
      .withArgs(router.address, pair.address, swapAmount)
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? 0 : swapAmount,
        pairToken0 === token0.address ? swapAmount : 0,
        pairToken0 === token0.address ? expectedOutputAmount : 0,
        pairToken0 === token0.address ? 0 : expectedOutputAmount,
        wallet.address
      )
  })

  it('swapTokensForExactNativeCurrency', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(5)
    const WNativeCurrencyAmount = expandTo18Decimals(10)

    const expectedSwapAmount = BigNumber.from('557227237267357629')
    const outputAmount = expandTo18Decimals(1)

    await token0.approve(router.address, constants.MaxUint256)
    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: WNativeCurrencyAmount }
    )

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    const pairToken0 = await pair.token0()
    await expect(
      router.swapTokensForExactNativeCurrency(
        outputAmount,
        constants.MaxUint256,
        [token0.address, WNativeCurrency.address],
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(token0, 'Transfer')
      .withArgs(wallet.address, pair.address, expectedSwapAmount)
      .to.emit(WNativeCurrency, 'Transfer')
      .withArgs(pair.address, router.address, outputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? expectedSwapAmount : 0,
        pairToken0 === token0.address ? 0 : expectedSwapAmount,
        pairToken0 === token0.address ? 0 : outputAmount,
        pairToken0 === token0.address ? outputAmount : 0,
        router.address
      )
  })

  it('swapNativeCurrencyForExactTokens', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(10)
    const WNativeCurrencyAmount = expandTo18Decimals(5)
    const expectedSwapAmount = BigNumber.from('557227237267357629')
    const outputAmount = expandTo18Decimals(1)

    await token0.approve(router.address, constants.MaxUint256)
    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: WNativeCurrencyAmount }
    )

    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)
    const pairToken0 = await pair.token0()

    await expect(
      router.swapNativeCurrencyForExactTokens(
        outputAmount,
        [WNativeCurrency.address, token0.address],
        wallet.address,
        constants.MaxUint256,
        {
          value: expectedSwapAmount
        }
      )
    )
      .to.emit(WNativeCurrency, 'Transfer')
      .withArgs(router.address, pair.address, expectedSwapAmount)
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, outputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? 0 : expectedSwapAmount,
        pairToken0 === token0.address ? expectedSwapAmount : 0,
        pairToken0 === token0.address ? outputAmount : 0,
        pairToken0 === token0.address ? 0 : outputAmount,
        wallet.address
      )
  })

  it('swapExactTokensForNativeCurrency', async () => {
    const WNativeCurrencyPartnerAmount = expandTo18Decimals(5)
    const WNativeCurrencyAmount = expandTo18Decimals(10)
    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from('1662497915624478906')

    await token0.approve(router.address, constants.MaxUint256)

    await router.addLiquidityNativeCurrency(
      token0.address,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyPartnerAmount,
      WNativeCurrencyAmount,
      wallet.address,
      constants.MaxUint256,
      { value: WNativeCurrencyAmount }
    )
    const bytecode = Pair.bytecode
    const create2Address = getCreate2Address(factory.address, [token0.address, WNativeCurrency.address], bytecode)
    const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)

    const pairToken0 = await pair.token0()
    await token0.approve(router.address, constants.MaxUint256)

    await expect(
      router.swapExactTokensForNativeCurrency(
        swapAmount,
        0,
        [token0.address, WNativeCurrency.address],
        wallet.address,
        constants.MaxUint256,
      )
    )
      .to.emit(token0, 'Transfer')
      .withArgs(wallet.address, pair.address, swapAmount)
      .to.emit(WNativeCurrency, 'Transfer')
      .withArgs(pair.address, router.address, expectedOutputAmount)
      .to.emit(pair, 'Swap')
      .withArgs(
        router.address,
        pairToken0 === token0.address ? swapAmount : 0,
        pairToken0 === token0.address ? 0 : swapAmount,
        pairToken0 === token0.address ? 0 : expectedOutputAmount,
        pairToken0 === token0.address ? expectedOutputAmount : 0,
        router.address
      )
  })

});
