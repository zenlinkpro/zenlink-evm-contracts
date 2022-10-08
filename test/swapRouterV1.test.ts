import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { deployments, ethers } from 'hardhat'
import { 
  BasicToken, 
  Factory, 
  LPToken, 
  MetaSwap, 
  NativeCurrency, 
  StableSwap, 
  SwapRouterV1 
} from '../types'
import { asyncForEach, MAX_UINT256 } from './shared/utilities'

describe('SwapRouterV1', async () => {
  let signers: Array<SignerWithAddress>
  let swapRouter: SwapRouterV1
  let factory: Factory
  let wNativeCurrency: NativeCurrency
  let baseSwap: StableSwap
  let metaSwap: MetaSwap
  let firstToken: BasicToken
  let secondToken: BasicToken
  let thirdToken: BasicToken
  let fourthToken: BasicToken
  let baseLPToken: LPToken
  let metaLPToken: LPToken
  let owner: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let ownerAddress: string
  let baseSwapStorage: {
    initialA: BigNumber
    futureA: BigNumber
    initialATime: BigNumber
    futureATime: BigNumber
    fee: BigNumber
    adminFee: BigNumber
    lpToken: string
  }
  let metaSwapStorage: {
    initialA: BigNumber
    futureA: BigNumber
    initialATime: BigNumber
    futureATime: BigNumber
    fee: BigNumber
    adminFee: BigNumber
    lpToken: string
  }

  const INITIAL_A_VALUE = 50
  const SWAP_FEE = 1e7
  const ADMIN_FEE = 0
  const LP_TOKEN_NAME = "Test LP Token Name"
  const LP_TOKEN_SYMBOL = "TESTLP"

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture() // ensure you start from a fresh deployments
      signers = await ethers.getSigners()
        ;[owner, user1, user2] = signers
      ownerAddress = owner.address

      const basicTokenFactory = await ethers.getContractFactory('BasicToken')
      firstToken = (await basicTokenFactory.deploy('First Token', 'FIRST', '18', '0')) as BasicToken
      secondToken = (await basicTokenFactory.deploy('Second Token', 'SECOND', '18', '0')) as BasicToken
      thirdToken = (await basicTokenFactory.deploy('Third Token', 'THIRD', '6', '0')) as BasicToken
      fourthToken = (await basicTokenFactory.deploy('Fourth Token', 'FOURTH', '6', '0')) as BasicToken

      await asyncForEach([owner, user1, user2], async (signer) => {
        const address = await signer.getAddress()
        await firstToken.setBalance(address, String(1e20))
        await secondToken.setBalance(address, String(1e20))
        await thirdToken.setBalance(address, String(1e8))
        await fourthToken.setBalance(address, String(1e8))
      })

      const stableSwapStorageFactory = await ethers.getContractFactory('StableSwapStorage')
      const stableSwapStorageLibrary = await stableSwapStorageFactory.deploy()
      const metaSwapStorageFactory = await ethers.getContractFactory('MetaSwapStorage')
      const metaSwapStorageLibrary = await metaSwapStorageFactory.deploy()

      const stableSwapFactory = await ethers.getContractFactory('StableSwap', {
        libraries: {
          'StableSwapStorage': stableSwapStorageLibrary.address
        }
      })
      baseSwap = (await stableSwapFactory.deploy()) as StableSwap
      const metaSwapFactory = await ethers.getContractFactory('MetaSwap', {
        libraries: {
          'StableSwapStorage': stableSwapStorageLibrary.address,
          'MetaSwapStorage': metaSwapStorageLibrary.address
        }
      })
      metaSwap = (await metaSwapFactory.deploy()) as MetaSwap

      await baseSwap.initialize(
        [firstToken.address, secondToken.address, thirdToken.address],
        [18, 18, 6],
        LP_TOKEN_NAME,
        LP_TOKEN_SYMBOL,
        INITIAL_A_VALUE,
        SWAP_FEE,
        ADMIN_FEE,
        owner.address
      )
      baseSwapStorage = await baseSwap.swapStorage()
      baseLPToken = (await ethers.getContractAt(
        'LPToken',
        baseSwapStorage.lpToken,
        owner
      )) as LPToken

      await asyncForEach(
        [firstToken, secondToken, thirdToken],
        async (token) => {
          await token.connect(user1).approve(baseSwap.address, MAX_UINT256)
        }
      )

      await baseSwap.connect(user1).addLiquidity(
        [String(1e18), String(1e18), String(1e6)],
        0,
        MAX_UINT256
      )

      await metaSwap.initializeMetaSwap(
        [fourthToken.address, baseLPToken.address],
        [6, 18],
        LP_TOKEN_NAME,
        LP_TOKEN_SYMBOL,
        INITIAL_A_VALUE,
        SWAP_FEE,
        ADMIN_FEE,
        owner.address,
        baseSwap.address
      )
      metaSwapStorage = await metaSwap.swapStorage()
      metaLPToken = (await ethers.getContractAt(
        'LPToken',
        metaSwapStorage.lpToken,
        owner
      )) as LPToken

      expect(await baseSwap.getVirtualPrice()).to.be.eq('1000000000000000000')
      expect(await metaSwap.getVirtualPrice()).to.be.eq(0)

      const factoryFactory = await ethers.getContractFactory('Factory')
      factory = (await factoryFactory.deploy(owner.address)) as Factory

      const nativeFactory = await ethers.getContractFactory('NativeCurrency')
      wNativeCurrency = (await nativeFactory.deploy("NativeCurrency", "Currency")) as NativeCurrency

      const swapRouterFactory = await ethers.getContractFactory('SwapRouterV1')
      swapRouter = (await swapRouterFactory.deploy(factory.address, wNativeCurrency.address)) as SwapRouterV1

      await asyncForEach([owner, user1, user2], async (signer) => {
        await firstToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await firstToken.connect(signer).approve(baseSwap.address, MAX_UINT256)
        await firstToken.connect(signer).approve(metaSwap.address, MAX_UINT256)
        await secondToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await secondToken.connect(signer).approve(baseSwap.address, MAX_UINT256)
        await secondToken.connect(signer).approve(metaSwap.address, MAX_UINT256)
        await thirdToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await thirdToken.connect(signer).approve(baseSwap.address, MAX_UINT256)
        await thirdToken.connect(signer).approve(metaSwap.address, MAX_UINT256)
        await fourthToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await fourthToken.connect(signer).approve(baseSwap.address, MAX_UINT256)
        await fourthToken.connect(signer).approve(metaSwap.address, MAX_UINT256)
        await baseLPToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await baseLPToken.connect(signer).approve(metaSwap.address, MAX_UINT256)
        await metaLPToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      })

      await baseSwap.addLiquidity([String(1e18), String(1e18), String(1e6)], 0, MAX_UINT256)
      await metaSwap.addLiquidity([String(1e6), String(1e18)], 0, MAX_UINT256)

      expect(await firstToken.balanceOf(baseSwap.address)).to.eq(String(2e18))
      expect(await secondToken.balanceOf(baseSwap.address)).to.eq(String(2e18))
      expect(await thirdToken.balanceOf(baseSwap.address)).to.eq(String(2e6))
      expect(await baseLPToken.balanceOf(metaSwap.address)).to.eq(String(1e18))
      expect(await fourthToken.balanceOf(metaSwap.address)).to.eq(String(1e6))

      const routerFactory = await ethers.getContractFactory('Router')
      const router = await routerFactory.deploy(factory.address, wNativeCurrency.address)

      await firstToken.connect(owner).approve(router.address, MAX_UINT256)
      await secondToken.connect(owner).approve(router.address, MAX_UINT256)
      await wNativeCurrency.connect(owner).approve(router.address, MAX_UINT256)
      await router.addLiquidity(
        firstToken.address,
        secondToken.address,
        String(1e18),
        String(1e18),
        0,
        0,
        owner.address,
        MAX_UINT256
      )
      await router.addLiquidityNativeCurrency(
        firstToken.address,
        String(1e18),
        0,
        0,
        owner.address,
        MAX_UINT256,
        { value: String(1e18) }
      )
    }
  )

  beforeEach(async () => {
    await setupTest()
  })

  it('factory, WNativeCurrency', async () => {
    expect(await swapRouter.factory()).to.eq(factory.address)
    expect(await swapRouter.WNativeCurrency()).to.eq(wNativeCurrency.address)
  })


  it('swapExactTokensForTokens', async () => {
    await swapRouter.swapExactTokensForTokens(
      String(1e16),
      0,
      [firstToken.address, secondToken.address],
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('96990000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98009871580343970612'))

    asyncForEach([firstToken, secondToken], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapTokensForExactTokens', async () => {
    await swapRouter.swapTokensForExactTokens(
      String(1e16),
      MAX_UINT256,
      [firstToken.address, secondToken.address],
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('96989868595686048043'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98010000000000000000'))

    asyncForEach([firstToken, secondToken], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapExactNativeCurrencyForTokens', async () => {
    await swapRouter.swapExactNativeCurrencyForTokens(
      0,
      [wNativeCurrency.address, firstToken.address],
      owner.address,
      MAX_UINT256,
      { value: String(1e16) }
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97009871580343970612'))

    asyncForEach([firstToken, wNativeCurrency], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapTokensForExactNativeCurrency', async () => {
    await swapRouter.swapTokensForExactNativeCurrency(
      String(1e16),
      MAX_UINT256,
      [firstToken.address, wNativeCurrency.address],
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('96989868595686048043'))

    asyncForEach([firstToken, wNativeCurrency], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapExactTokensForNativeCurrency', async () => {
    await swapRouter.swapExactTokensForNativeCurrency(
      String(1e16),
      0,
      [firstToken.address, wNativeCurrency.address],
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('96990000000000000000'))

    asyncForEach([firstToken, wNativeCurrency], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapNativeCurrencyForExactTokens', async () => {
    await swapRouter.swapNativeCurrencyForExactTokens(
      String(1e16),
      [wNativeCurrency.address, firstToken.address],
      owner.address,
      MAX_UINT256,
      { value: String(1e18) }
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97010000000000000000'))

    asyncForEach([firstToken, wNativeCurrency], async (token) => {
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPool', async () => {
    await swapRouter.swapPool(
      baseSwap.address,
      0,
      2,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('96990000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009989'))

    asyncForEach([firstToken, secondToken, thirdToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolFromBase', async () => {
    await swapRouter.swapPoolFromBase(
      metaSwap.address,
      baseSwap.address,
      1,
      0,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97000000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97990000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009982'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolToBase', async () => {
    await swapRouter.swapPoolToBase(
      metaSwap.address,
      baseSwap.address,
      0,
      2,
      String(1e4),
      0,
      owner.address,
      MAX_UINT256,
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97000000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009982'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98990000'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  describe('swapExactTokensForTokensThroughStablePool', async () => {
    it('revert with "INSUFFICIENT_OUTPUT_AMOUNT"', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[secondToken.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await expect(swapRouter.swapExactTokensForTokensThroughStablePool(
        String(1e16),
        MAX_UINT256,
        routes,
        owner.address,
        MAX_UINT256,
      )).to.be.revertedWith("SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT")
    })

    it('second -> first -> fourth', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[secondToken.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await swapRouter.swapExactTokensForTokensThroughStablePool(
        String(1e16),
        0,
        routes,
        owner.address,
        MAX_UINT256,
      )

      expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97000000000000000000'))
      expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97990000000000000000'))
      expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
      expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009854'))
      expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
      expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

      asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
        expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
        expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
        expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
      })
    })
  })

  describe('swapExactNativeCurrencyForTokensThroughStablePool', async () => {
    it('revert with "SwapRouterV1: INVALID_ROUTES": 01', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[secondToken.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          fourthToken.address,
          secondToken.address,
          false
        ]
      )
      const routes = [
        { stable: true, callData: stableRoute },
        { stable: false, callData: ammPath }
      ]

      await expect(swapRouter.swapExactNativeCurrencyForTokensThroughStablePool(
        0,
        routes,
        owner.address,
        MAX_UINT256,
        { value: String(1e16) }
      )).to.be.revertedWith("SwapRouterV1: INVALID_ROUTES")
    })

    it('revert with "SwapRouterV1: INVALID_ROUTES": 02', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[secondToken.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await expect(swapRouter.swapExactNativeCurrencyForTokensThroughStablePool(
        0,
        routes,
        owner.address,
        MAX_UINT256,
        { value: String(1e16) }
      )).to.be.revertedWith("SwapRouterV1: INVALID_ROUTES")
    })

    it('revert with "SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT"', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[wNativeCurrency.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await expect(swapRouter.swapExactNativeCurrencyForTokensThroughStablePool(
        MAX_UINT256,
        routes,
        owner.address,
        MAX_UINT256,
        { value: String(1e16) }
      )).to.be.revertedWith("SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT")
    })

    it('wNativeCurrency -> first -> fourth', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[wNativeCurrency.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await swapRouter.swapExactNativeCurrencyForTokensThroughStablePool(
        0,
        routes,
        owner.address,
        MAX_UINT256,
        { value: String(1e16) }
      )

      expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97000000000000000000'))
      expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
      expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
      expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009854'))
      expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
      expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

      asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
        expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
        expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
        expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
      })
    })
  })

  describe('swapExactTokensForNativeCurrencyThroughStablePool', async () => {
    it('revert with "SwapRouterV1: INVALID_ROUTES": 01', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[wNativeCurrency.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          firstToken.address,
          fourthToken.address,
          true
        ]
      )
      const routes = [
        { stable: false, callData: ammPath },
        { stable: true, callData: stableRoute }
      ]

      await expect(swapRouter.swapExactTokensForNativeCurrencyThroughStablePool(
        String(1e16),
        0,
        routes,
        owner.address,
        MAX_UINT256,
      )).to.be.revertedWith("SwapRouterV1: INVALID_ROUTES")
    })

    it('revert with "SwapRouterV1: INVALID_ROUTES": 02', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[wNativeCurrency.address, firstToken.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          fourthToken.address,
          firstToken.address,
          false
        ]
      )
      const routes = [
        { stable: true, callData: stableRoute },
        { stable: false, callData: ammPath }
      ]

      await expect(swapRouter.swapExactTokensForNativeCurrencyThroughStablePool(
        String(1e4),
        0,
        routes,
        owner.address,
        MAX_UINT256,
      )).to.be.revertedWith("SwapRouterV1: INVALID_ROUTES")
    })

    it('revert with "SwapRouterV1: INVALID_ROUTES": 02', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[firstToken.address, wNativeCurrency.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          fourthToken.address,
          firstToken.address,
          false
        ]
      )
      const routes = [
        { stable: true, callData: stableRoute },
        { stable: false, callData: ammPath }
      ]

      await expect(swapRouter.swapExactTokensForNativeCurrencyThroughStablePool(
        String(1e4),
        MAX_UINT256,
        routes,
        owner.address,
        MAX_UINT256,
      )).to.be.revertedWith("SwapRouterV1: INSUFFICIENT_OUTPUT_AMOUNT")
    })

    it('foutrh -> first -> wNativeCurrency', async () => {
      const ammPath = ethers.utils.defaultAbiCoder.encode(
        ["address[]"],
        [[firstToken.address, wNativeCurrency.address]]
      )
      const stableRoute = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address", "bool"],
        [
          metaSwap.address,
          baseSwap.address,
          fourthToken.address,
          firstToken.address,
          false
        ]
      )
      const routes = [
        { stable: true, callData: stableRoute },
        { stable: false, callData: ammPath }
      ]

      await swapRouter.swapExactTokensForNativeCurrencyThroughStablePool(
        String(1e4),
        0,
        routes,
        owner.address,
        MAX_UINT256,
      )

      expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97000000000000000000'))
      expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
      expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
      expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98990000'))
      expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
      expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

      asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
        expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
        expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
        expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
      })
    })
  })
})
