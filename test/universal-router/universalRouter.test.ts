import { defaultAbiCoder } from "@ethersproject/abi"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { deployments } from "hardhat"
import {
  BasicToken,
  Factory,
  FeeSettlement,
  Pair,
  ReferralStorage,
  StableSwap,
  StableSwapDispatcher,
  UniversalRouter,
  WETH
} from "../../types"
import { HEXer } from "../shared/HEXer"
import {
  asyncForEach,
  expandTo18Decimals,
  expandTo6Decimals,
  MAX_UINT256,
  NATIVE_ADDRESS
} from "../shared/utilities"

describe("UniversalRouter", () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let user0: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let feeTo: SignerWithAddress
  let weth: WETH
  let USDC: BasicToken
  let USDT: BasicToken
  let DAI: BasicToken
  let PAIR_WETH_USDC: Pair
  let PAIR_WETH_DAI: Pair
  let stableSwap: StableSwap
  let feeSettlement: FeeSettlement
  let stableSwapDispatcher: StableSwapDispatcher
  let router: UniversalRouter

  const setupTest = deployments.createFixture(async ({ deployments, ethers }) => {
    await deployments.fixture()
    signers = await ethers.getSigners()
      ;[wallet, user0, user1, user2, feeTo] = signers

    const wethFactory = await ethers.getContractFactory('WETH')
    weth = (await wethFactory.deploy()) as WETH
    const referralStorageFactory = await ethers.getContractFactory('ReferralStorage')
    const referralStorage = (await referralStorageFactory.deploy()) as ReferralStorage
    const feeSettlementFactory = await ethers.getContractFactory('FeeSettlement')
    feeSettlement = (await feeSettlementFactory.deploy(
      weth.address,
      referralStorage.address,
      0,
      0,
      0,
      feeTo.address
    )) as FeeSettlement
    const stableSwapDispatcherFactory = await ethers.getContractFactory('StableSwapDispatcher')
    stableSwapDispatcher = (await stableSwapDispatcherFactory.deploy(weth.address)) as StableSwapDispatcher
    const routerFactory = await ethers.getContractFactory('UniversalRouter')
    router = (await routerFactory.deploy(stableSwapDispatcher.address, feeSettlement.address)) as UniversalRouter

    // tokens
    const basicTokenFactory = await ethers.getContractFactory('BasicToken')
    USDC = (await basicTokenFactory.deploy('USDC', 'USDC', 6, 0)) as BasicToken
    USDT = (await basicTokenFactory.deploy('USDT', 'USDT', 6, 0)) as BasicToken
    DAI = (await basicTokenFactory.deploy('DAI', 'DAI', 18, 0)) as BasicToken
    await asyncForEach([wallet, user0, user1], async (signer) => {
      await USDC.setBalance(signer.address, expandTo6Decimals(100))
      await USDC.connect(signer).approve(router.address, MAX_UINT256)
      await USDT.setBalance(signer.address, expandTo6Decimals(100))
      await USDT.connect(signer).approve(router.address, MAX_UINT256)
      await DAI.setBalance(signer.address, expandTo18Decimals(100))
      await DAI.connect(signer).approve(router.address, MAX_UINT256)
    })

    const factoryFactory = await ethers.getContractFactory('Factory')
    const factory = (await factoryFactory.deploy(wallet.address)) as Factory
    await factory.createPair(weth.address, USDC.address)
    await factory.createPair(weth.address, DAI.address)
    PAIR_WETH_USDC = (await ethers.getContractAt('Pair', await factory.getPair(weth.address, USDC.address))) as Pair
    PAIR_WETH_DAI = (await ethers.getContractAt('Pair', await factory.getPair(weth.address, DAI.address))) as Pair

    await weth.deposit({ value: expandTo18Decimals(100) })
    await weth.transfer(PAIR_WETH_USDC.address, expandTo18Decimals(50))
    await USDC.transfer(PAIR_WETH_USDC.address, expandTo6Decimals(5))
    await PAIR_WETH_USDC.mint(wallet.address)
    await weth.transfer(PAIR_WETH_DAI.address, expandTo18Decimals(50))
    await DAI.transfer(PAIR_WETH_DAI.address, expandTo18Decimals(5))
    await PAIR_WETH_DAI.mint(wallet.address)

    const stableSwapStorageFactory = await ethers.getContractFactory('StableSwapStorage')
    const stableSwapStorage = await stableSwapStorageFactory.deploy()
    const stableSwapFactory = await ethers.getContractFactory('StableSwap', {
      libraries: {
        'StableSwapStorage': stableSwapStorage.address
      }
    })
    stableSwap = (await stableSwapFactory.deploy()) as StableSwap
    await stableSwap.initialize(
      [USDC.address, USDT.address, DAI.address],
      [6, 6, 18],
      '3pool',
      '3pool_lp',
      50,
      1e7,
      0,
      wallet.address
    )
    await asyncForEach([USDC, USDT, DAI], async (token) => {
      await token.approve(stableSwap.address, MAX_UINT256)
    })
    await stableSwap.addLiquidity(
      [expandTo6Decimals(10), expandTo6Decimals(10), expandTo18Decimals(10)],
      0,
      MAX_UINT256
    )
  })

  beforeEach(async () => {
    await setupTest()
  })

  it('reverts for an invalid command at index 1', async () => {
    let code = '0x'
    code += new HEXer()
      .uint8(0)
      .toString()
    await expect(router.processRoute(
      NATIVE_ADDRESS,
      expandTo18Decimals(1),
      NATIVE_ADDRESS,
      0,
      user1.address,
      code,
      { value: expandTo18Decimals(1) }
    )).to.be.revertedWithCustomError(router, 'InvalidCommandCode')
  })

  it('reverts if output less than `amountOutMin`', async () => {
    let code = '0x'
    code += new HEXer()
      .uint8(5)
      .address(weth.address)
      .uint8(1)
      .address(PAIR_WETH_USDC.address)
      .uint(expandTo18Decimals(1))
      .toString()
    await expect(router.processRoute(
      NATIVE_ADDRESS,
      expandTo18Decimals(1),
      NATIVE_ADDRESS,
      expandTo18Decimals(2),
      user1.address,
      code,
      { value: expandTo18Decimals(1) }
    )).to.be.revertedWithCustomError(router, 'InsufficientOutAmount')
  })

  it('reverts if the amountIn is not fully consumed', async () => {
    let code = '0x'
    code += new HEXer()
      .uint8(5)
      .address(weth.address)
      .uint8(2)
      .address(PAIR_WETH_USDC.address)
      .uint(expandTo18Decimals(1))
      .address(PAIR_WETH_DAI.address)
      .uint(expandTo18Decimals(1))
      .toString()
    await expect(router.processRoute(
      NATIVE_ADDRESS,
      expandTo18Decimals(3),
      NATIVE_ADDRESS,
      expandTo18Decimals(2),
      user1.address,
      code,
      { value: expandTo18Decimals(3) }
    )).to.be.revertedWithCustomError(router, 'WrongAmountInValue')
  })

  it('Native => USDC => Native', async () => {
    let code = '0x'
    const prevBalance = await user1.getBalance()
    // wrap
    code += new HEXer()
      .uint8(5)
      .address(weth.address)
      .uint8(1)
      .address(PAIR_WETH_USDC.address)
      .uint(expandTo18Decimals(1))
      .toString()
    // swap
    code += new HEXer()
      .uint8(10)
      .address(PAIR_WETH_USDC.address)
      .address(weth.address)
      .bool(weth.address === await PAIR_WETH_USDC.token0())
      .address(router.address)
      .toString()
    // distribute shares
    code += new HEXer()
      .uint8(4)
      .address(USDC.address)
      .uint8(1)
      .address(PAIR_WETH_USDC.address)
      .share16(1)
      .toString()
    // swap
    code += new HEXer()
      .uint8(10)
      .address(PAIR_WETH_USDC.address)
      .address(USDC.address)
      .bool(USDC.address === await PAIR_WETH_USDC.token0())
      .address(router.address)
      .toString()
    // unwrap
    code += new HEXer()
      .uint8(6)
      .address(weth.address)
      .address(feeSettlement.address)
      .toString()

    await router.processRoute(
      NATIVE_ADDRESS,
      expandTo18Decimals(1),
      NATIVE_ADDRESS,
      expandTo18Decimals(1).mul(994).div(1000),
      user1.address,
      code,
      { value: expandTo18Decimals(1) }
    )
    expect((await user1.getBalance()).sub(prevBalance))
      .to.gt(expandTo18Decimals(1).mul(994).div(1000))
  })

  it('Native -> USDC -> DAI -> Native', async () => {
    let code = '0x'
    const prevBalance = await user2.getBalance()
    // wrap
    code += new HEXer()
      .uint8(5)
      .address(weth.address)
      .uint8(1)
      .address(PAIR_WETH_USDC.address)
      .uint(expandTo18Decimals(1))
      .toString()
    // swap
    code += new HEXer()
      .uint8(10)
      .address(PAIR_WETH_USDC.address)
      .address(weth.address)
      .bool(weth.address === await PAIR_WETH_USDC.token0())
      .address(router.address)
      .toString()
    // distribute shares
    code += new HEXer()
      .uint8(4)
      .address(USDC.address)
      .uint8(1)
      .address(stableSwapDispatcher.address)
      .share16(1)
      .toString()
    // stableSwap
    code += new HEXer()
      .uint8(20)
      .uint8(0)
      .address(PAIR_WETH_DAI.address)
      .bytes(defaultAbiCoder.encode(
        ['address', 'bool', 'uint8', 'uint8', 'address', 'address'], 
        [stableSwap.address, false, 0, 2, USDC.address, DAI.address])
      )
      .toString()
      // swap
    code += new HEXer()
      .uint8(10)
      .address(PAIR_WETH_DAI.address)
      .address(DAI.address)
      .bool(DAI.address === await PAIR_WETH_DAI.token0())
      .address(router.address)
      .toString()
    // unwrap
    code += new HEXer()
      .uint8(6)
      .address(weth.address)
      .address(feeSettlement.address)
      .toString()

    await router.processRoute(
      NATIVE_ADDRESS,
      expandTo18Decimals(1),
      NATIVE_ADDRESS,
      expandTo18Decimals(1).mul(954).div(1000),
      user2.address,
      code,
      { value: expandTo18Decimals(1) }
    )
    expect((await user2.getBalance()).sub(prevBalance))
      .to.gt(expandTo18Decimals(1).mul(954).div(1000))
  })
})
