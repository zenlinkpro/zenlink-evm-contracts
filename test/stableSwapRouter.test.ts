import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { deployments, ethers } from 'hardhat'
import { BasicToken, LPToken, MetaSwap, StableSwap, StableSwapRouter } from '../types'
import { asyncForEach, MAX_UINT256 } from './shared/utilities'

describe('StableSwapRouter', async () => {
  let signers: Array<SignerWithAddress>
  let swapRouter: StableSwapRouter
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
          await token.approve(baseSwap.address, MAX_UINT256)
        }
      )

      await baseSwap.addLiquidity(
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

      const swapRouterFactory = await ethers.getContractFactory('StableSwapRouter')
      swapRouter = (await swapRouterFactory.deploy()) as StableSwapRouter

      await asyncForEach([owner, user1, user2], async (signer) => {
        await firstToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await secondToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await thirdToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await fourthToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await baseLPToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
        await metaLPToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      })
    }
  )

  beforeEach(async () => {
    await setupTest()
  })

  it('convert', async () => {
    const toConvertSwapStorageFactory = await ethers.getContractFactory('StableSwapStorage')
    const toConvertSwapStorage = await toConvertSwapStorageFactory.deploy()
    const toConvertSwapFactory = await ethers.getContractFactory('StableSwap', {
      libraries: {
        'StableSwapStorage': toConvertSwapStorage.address
      }
    })
    const toConvertSwap = await toConvertSwapFactory.deploy()
    await toConvertSwap.initialize(
      [firstToken.address, secondToken.address, thirdToken.address],
      [18, 18, 6],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A_VALUE,
      SWAP_FEE,
      ADMIN_FEE,
      owner.address
    )

    expect(await firstToken.balanceOf(toConvertSwap.address)).to.eq(String(0))
    expect(await secondToken.balanceOf(toConvertSwap.address)).to.eq(String(0))
    expect(await thirdToken.balanceOf(toConvertSwap.address)).to.eq(String(0))

    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )
    const lpAmount = await baseLPToken.balanceOf(ownerAddress)

    await swapRouter.convert(
      baseSwap.address,
      toConvertSwap.address,
      lpAmount,
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(toConvertSwap.address)).to.eq(String(2e18))
    expect(await secondToken.balanceOf(toConvertSwap.address)).to.eq(String(2e18))
    expect(await thirdToken.balanceOf(toConvertSwap.address)).to.eq(String(2e6))
  })

  it('addPoolLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(String(6e18))

    await swapRouter.addPoolLiquidity(
      metaSwap.address,
      [String(1e6), String(1e18)],
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(String(5e18))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(String(2e18))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('addPoolAndBaseLiquidity', async () => {
    const expectLpAmount = await metaSwap.calculateTokenAmount(
      [String(1e6), String(3e18)],
      true
    )
    await swapRouter.addPoolAndBaseLiquidity(
      metaSwap.address,
      baseSwap.address,
      [String(1e6), 0],
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(expectLpAmount)

    await asyncForEach(
      [firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken],
      async (token) => {
        expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
        expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
        expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
      })
  })

  it('removePoolLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolLiquidity(
      baseSwap.address,
      String(1e18),
      [0, 0, 0],
      owner.address,
      MAX_UINT256
    )

    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(String(5e18))
    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98333333333333333333'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98333333333333333333'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98333333'))

    asyncForEach([firstToken, secondToken, thirdToken, baseLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolLiquidityOneToken', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolLiquidityOneToken(
      baseSwap.address,
      String(1e18),
      0,
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(String(5e18))
    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98994453519013542760'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))

    asyncForEach([firstToken, baseLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolAndBaseLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      metaSwap.address,
      [String(1e6), String(1e18)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolAndBaseLiquidity(
      metaSwap.address,
      baseSwap.address,
      String(1e18),
      [String(0), String(0)],
      [String(0), String(0), String(0)],
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98166666666666666666'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98166666666666666666'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98166666'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99500000'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('5000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('1000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolAndBaseLiquidityOneToken', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      metaSwap.address,
      [String(1e6), String(1e18)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolAndBaseLiquidityOneToken(
      metaSwap.address,
      baseSwap.address,
      String(1e18),
      0,
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98949470360446232144'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('5000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('1000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPool', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPool(
      baseSwap.address,
      1,
      0,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98009989020660718509'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97990000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('6000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, baseLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolFromBase', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      metaSwap.address,
      [String(1e6), String(1e18)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPoolFromBase(
      metaSwap.address,
      baseSwap.address,
      0,
      0,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('97990000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009982'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('5000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolToBase', async () => {
    await swapRouter.addPoolLiquidity(
      baseSwap.address,
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      metaSwap.address,
      [String(1e6), String(1e18)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPoolToBase(
      metaSwap.address,
      baseSwap.address,
      0,
      0,
      String(1e6),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98904215562925448542'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await baseLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('5000000000000000000'))
    expect(await metaLPToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, baseLPToken, metaLPToken], async (token) => {
      expect(await token.allowance(swapRouter.address, baseSwap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, metaSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })
})
