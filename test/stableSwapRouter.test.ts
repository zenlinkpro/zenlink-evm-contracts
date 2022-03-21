import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, Contract, ContractFactory, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import TestERC20 from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import StableSwap from '../build/contracts/stableswap/StableSwap.sol/StableSwap.json'
import StableSwapStorage from '../build/contracts/stableswap/StableSwapStorage.sol/StableSwapStorage.json'
import StableSwapRouter from '../build/contracts/periphery/StableSwapRouter.sol/StableSwapRouter.json'
import { 
  asyncForEach, 
  linkBytecode, 
  MAX_UINT256
} from './shared/utilities'

chai.use(solidity)

describe('StableSwapRouter', async () => {
  let signers: Array<Wallet>
  let swapRouter: Contract
  let swap: Contract
  let secondSwap: Contract
  let firstToken: Contract
  let secondToken: Contract
  let thirdToken: Contract
  let fourthToken: Contract
  let swapToken: Contract
  let secondSwapToken: Contract
  let owner: Wallet
  let user1: Wallet
  let user2: Wallet
  let ownerAddress: string
  let user1Address: string
  let user2Address: string
  let swapStorage: {
    initialA: BigNumber
    futureA: BigNumber
    initialATime: BigNumber
    futureATime: BigNumber
    fee: BigNumber
    adminFee: BigNumber
    lpToken: string
  }
  let secondSwapStorage: {
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
  
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 99999999999,
    },
  })

  async function setupTest() {
    signers = provider.getWallets()
    owner = signers[0]
    user1 = signers[1]
    user2 = signers[2]
    ownerAddress = owner.address
    user1Address = user1.address
    user2Address = user2.address

    firstToken = await deployContract(
      owner,
      TestERC20,
      ['First Token', 'FIRST', '18', '0']
    )

    secondToken = await deployContract(
      owner,
      TestERC20,
      ['Second Token', 'SECOND', '18', '0']
    )

    thirdToken = await deployContract(
      owner,
      TestERC20,
      ['Third Token', 'THIRD', '6', '0']
    )

    fourthToken = await deployContract(
      owner,
      TestERC20,
      ['Fourth Token', 'FOURTH', '6', '0']
    )

    await asyncForEach([owner, user1, user2], async (signer) => {
      const address = await signer.getAddress()
      await firstToken.setBalance(address, String(1e20))
      await secondToken.setBalance(address, String(1e20))
      await thirdToken.setBalance(address, String(1e8))
      await fourthToken.setBalance(address, String(1e8))
    })

    const swapStorageContract = await deployContract(owner, StableSwapStorage)
    const secondSwapStorageContract = await deployContract(owner, StableSwapStorage)

    const swapFactory = (await ethers.getContractFactory(
      StableSwap.abi,
      linkBytecode(StableSwap, {
        'StableSwapStorage': swapStorageContract.address
      }),
      owner,
    )) as ContractFactory
    const secondSwapFactory = (await ethers.getContractFactory(
      StableSwap.abi,
      linkBytecode(StableSwap, {
        'StableSwapStorage': secondSwapStorageContract.address
      }),
      owner,
    )) as ContractFactory

    swap = await swapFactory.deploy()
    secondSwap = await secondSwapFactory.deploy()

    await swap.initialize(
      [firstToken.address, secondToken.address, thirdToken.address],
      [18, 18, 6],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A_VALUE,
      SWAP_FEE,
      ADMIN_FEE,
      owner.address
    )
    swapStorage = await swap.swapStorage()
    swapToken = await ethers.getContractAt(
      'LPToken',
      swapStorage.lpToken,
      owner
    )

    await secondSwap.initialize(
      [swapToken.address, fourthToken.address],
      [18, 6],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A_VALUE,
      SWAP_FEE,
      ADMIN_FEE,
      owner.address
    )
    secondSwapStorage = await secondSwap.swapStorage()
    secondSwapToken = await ethers.getContractAt(
      'LPToken',
      secondSwapStorage.lpToken,
      owner
    )

    expect(await swap.getVirtualPrice()).to.be.eq(0)
    expect(await secondSwap.getVirtualPrice()).to.be.eq(0)

    swapRouter = await deployContract(
      owner,
      StableSwapRouter,
      []
    )

    await asyncForEach([owner, user1, user2], async (signer) => {
      await firstToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      await secondToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      await thirdToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      await fourthToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      await swapToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
      await secondSwapToken.connect(signer).approve(swapRouter.address, MAX_UINT256)
    })
  }

  beforeEach(async () => {
    await setupTest()
  })

  it('convert', async () => {
    const toConvertSwapStorageContract = await deployContract(owner, StableSwapStorage)
    const toConvertswapFactory = (await ethers.getContractFactory(
      StableSwap.abi,
      linkBytecode(StableSwap, {
        'StableSwapStorage': toConvertSwapStorageContract.address
      }),
      owner,
    )) as ContractFactory
    const toConvertSwap = await toConvertswapFactory.deploy()
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
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )
    const lpAmount = await swapToken.balanceOf(ownerAddress)

    await swapRouter.convert(
      swap.address,
      toConvertSwap.address,
      lpAmount,
      0,
      owner.address,
      MAX_UINT256
    )
    
    expect(await firstToken.balanceOf(toConvertSwap.address)).to.eq(String(1e18))
    expect(await secondToken.balanceOf(toConvertSwap.address)).to.eq(String(1e18))
    expect(await thirdToken.balanceOf(toConvertSwap.address)).to.eq(String(1e6))
  })

  it('addPoolLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    expect(await swapToken.balanceOf(ownerAddress)).to.eq(String(3e18))

    await swapRouter.addPoolLiquidity(
      secondSwap.address,
      [String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await swapToken.balanceOf(ownerAddress)).to.eq(String(2e18))
    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(String(2e18))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('addPoolAndBaseLiquidity', async () => {
    const expectLpAmount = await secondSwap.calculateTokenAmount(
      [String(3e18), String(1e6)],
      true
    )
    await swapRouter.addPoolAndBaseLiquidity(
      secondSwap.address,
      swap.address,
      [0, String(1e6)],
      [String(1e18), String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(expectLpAmount)

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, swapToken, secondSwapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolLiquidity(
      swap.address,
      String(1e18),
      [0, 0, 0],
      owner.address,
      MAX_UINT256
    )

    expect(await swapToken.balanceOf(ownerAddress)).to.eq(String(2e18))
    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99333333333333333333'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99333333333333333333'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99333333'))

    asyncForEach([firstToken, secondToken, thirdToken, swapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolLiquidityOneToken', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolLiquidityOneToken(
      swap.address,
      String(1e18),
      0,
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await swapToken.balanceOf(ownerAddress)).to.eq(String(2e18))
    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99943111614953373621'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))

    asyncForEach([firstToken, swapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolAndBaseLiquidity', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      secondSwap.address,
      [String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolAndBaseLiquidity(
      secondSwap.address,
      swap.address,
      String(1e18),
      [String(0), String(0)],
      [String(0), String(0), String(0)],
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99166666666666666666'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99166666666666666666'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99166666'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99500000'))
    expect(await swapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('1000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, swapToken, secondSwapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('removePoolAndBaseLiquidityOneToken', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      secondSwap.address,
      [String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.removePoolAndBaseLiquidityOneToken(
      secondSwap.address,
      swap.address,
      String(1e18),
      0,
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99915975025371929634'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await swapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('1000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, swapToken, secondSwapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPool', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPool(
      swap.address,
      1,
      0,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009988041372295327'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98990000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await swapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('3000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, swapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolFromBase', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      secondSwap.address,
      [String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPoolFromBase(
      secondSwap.address,
      swap.address,
      0,
      1,
      String(1e16),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98990000000000000000'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99009982'))
    expect(await swapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, swapToken, secondSwapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })

  it('swapPoolToBase', async () => {
    await swapRouter.addPoolLiquidity(
      swap.address,
      [String(1e18), String(1e18), String(1e6)], 
      0, 
      owner.address,
      MAX_UINT256
    )

    await swapRouter.addPoolLiquidity(
      secondSwap.address,
      [String(1e18), String(1e6)],
      0,
      owner.address,
      MAX_UINT256
    )

    await swapRouter.swapPoolToBase(
      secondSwap.address,
      swap.address,
      1,
      0,
      String(1e6),
      0,
      owner.address,
      MAX_UINT256
    )

    expect(await firstToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99881980616021312485'))
    expect(await secondToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000000000000000'))
    expect(await thirdToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('99000000'))
    expect(await fourthToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('98000000'))
    expect(await swapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))
    expect(await secondSwapToken.balanceOf(ownerAddress)).to.eq(BigNumber.from('2000000000000000000'))

    asyncForEach([firstToken, secondToken, thirdToken, fourthToken, swapToken, secondSwapToken], async (token) => {
      expect(await token.allowance(swapRouter.address, swap.address)).to.eq(String(0))
      expect(await token.allowance(swapRouter.address, secondSwap.address)).to.eq(String(0))
      expect(await token.balanceOf(swapRouter.address)).to.eq(String(0))
    })
  })
})