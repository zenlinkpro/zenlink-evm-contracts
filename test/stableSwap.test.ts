import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, Contract, ContractFactory, Signer, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import TestERC20 from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import StableSwap from '../build/contracts/stableswap/StableSwap.sol/StableSwap.json'
import StableSwapStorage from '../build/contracts/stableswap/StableSwapStorage.sol/StableSwapStorage.json'
import MockStableSwapBorrower from '../build/contracts/test/MockStableSwapBorrower.sol/MockStableSwapBorrower.json'
import { 
  asyncForEach, 
  forceAdvanceOneBlock, 
  getCurrentBlockTimestamp, 
  getUserTokenBalance, 
  getUserTokenBalances, 
  linkBytecode, 
  MAX_UINT256, 
  setNextTimestamp, 
  setTimestamp, 
  TIME, 
  ZERO_ADDRESS 
} from './shared/utilities'
import snapshotGasCost from './shared/snapshotGasCost'

chai.use(solidity)

describe('StableSwap', async () => {
  let signers: Array<Wallet>
  let swap: Contract
  let firstToken: Contract
  let secondToken: Contract
  let swapToken: Contract
  let owner: Wallet
  let user1: Wallet
  let user2: Wallet
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

  // Test Values
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

    await asyncForEach([owner, user1, user2], async (signer) => {
      const address = await signer.getAddress()
      await firstToken.setBalance(address, String(1e20))
      await secondToken.setBalance(address, String(1e20))
    })

    const swapStorageContract = await deployContract(owner, StableSwapStorage)

    const swapFactory = (await ethers.getContractFactory(
      StableSwap.abi,
      linkBytecode(StableSwap, {
        'StableSwapStorage': swapStorageContract.address
      }),
      owner,
    )) as ContractFactory

    swap = await swapFactory.deploy()

    await swap.initialize(
      [firstToken.address, secondToken.address],
      [18, 18],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A_VALUE,
      SWAP_FEE,
      ADMIN_FEE,
      owner.address
    )

    expect(await swap.getVirtualPrice()).to.be.eq(0)

    swapStorage = await swap.swapStorage()

    swapToken = await ethers.getContractAt(
      'LPToken',
      swapStorage.lpToken,
      owner
    )

    await asyncForEach([owner, user1, user2], async (signer) => {
      await firstToken.connect(signer).approve(swap.address, MAX_UINT256)
      await secondToken.connect(signer).approve(swap.address, MAX_UINT256)
      await swapToken.connect(signer).approve(swap.address, MAX_UINT256)
    })

    await swap.addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)

    expect(await firstToken.balanceOf(swap.address)).to.eq(String(1e18))
    expect(await secondToken.balanceOf(swap.address)).to.eq(String(1e18))
  }

  beforeEach(async () => {
    await setupTest()
  })

  describe('swapStorage', () => {
    describe("lpToken", async () => {
      it("Returns correct lpTokenName", async () => {
        expect(await swapToken.name()).to.eq(LP_TOKEN_NAME)
      })

      it("Returns correct lpTokenSymbol", async () => {
        expect(await swapToken.symbol()).to.eq(LP_TOKEN_SYMBOL)
      })

      it("Returns true after successfully calling transferFrom", async () => {
        // User 1 adds liquidity
        await swap
          .connect(user1)
          .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)

        // User 1 approves User 2 for MAX_UINT256
        swapToken.connect(user1).approve(user2Address, MAX_UINT256)

        // User 2 transfers 1337 from User 1 to themselves using transferFrom
        await swapToken
          .connect(user2)
          .transferFrom(user1Address, user2Address, 1337)

        expect(await swapToken.balanceOf(user2Address)).to.eq(1337)
      })
    })

    describe("A", async () => {
      it("Returns correct A value", async () => {
        expect(await swap.getA()).to.eq(INITIAL_A_VALUE)
        expect(await swap.getAPrecise()).to.eq(INITIAL_A_VALUE * 100)
      })
    })

    describe("fee", async () => {
      it("Returns correct fee value", async () => {
        expect((await swap.swapStorage()).fee).to.eq(SWAP_FEE)
      })
    })

    describe("adminFee", async () => {
      it("Returns correct adminFee value", async () => {
        expect(swapStorage.adminFee).to.eq(0)
      })
    })
  })

  describe("getToken", () => {
    it("Returns correct addresses of pooled tokens", async () => {
      expect(await swap.getToken(0)).to.eq(firstToken.address)
      expect(await swap.getToken(1)).to.eq(secondToken.address)
    })

    it("Reverts when index is out of range", async () => {
      await expect(swap.getToken(2)).to.be.reverted
    })
  })

  describe("getTokenIndex", () => {
    it("Returns correct token indexes", async () => {
      expect(await swap.getTokenIndex(firstToken.address)).to.be.eq(0)
      expect(await swap.getTokenIndex(secondToken.address)).to.be.eq(1)
    })

    it("Reverts when token address is not found", async () => {
      await expect(swap.getTokenIndex(ZERO_ADDRESS)).to.be.revertedWith(
        "tokenNotFound",
      )
    })
  })

  describe("getTokenBalance", () => {
    it("Returns correct balances of pooled tokens", async () => {
      expect(await swap.getTokenBalance(0)).to.eq(BigNumber.from(String(1e18)))
      expect(await swap.getTokenBalance(1)).to.eq(BigNumber.from(String(1e18)))
    })

    it("Reverts when index is out of range", async () => {
      await expect(swap.getTokenBalance(2)).to.be.reverted
    })
  })

  describe("getA", () => {
    it("Returns correct value", async () => {
      expect(await swap.getA()).to.eq(INITIAL_A_VALUE)
    })
  })

  describe("addLiquidity", () => {
    it("Reverts when contract is paused", async () => {
      await swap.pause()

      await expect(
        swap
          .connect(user1)
          .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256),
      ).to.be.reverted

      // unpause
      await swap.unpause()

      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      const actualPoolTokenAmount = await swapToken.balanceOf(user1Address)
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    it("Reverts with 'invalidAmountsLength'", async () => {
      await expect(
        swap.connect(user1).addLiquidity([String(1e16)], 0, MAX_UINT256),
      ).to.be.revertedWith("invalidAmountsLength")
    })

    it("Reverts because of 'Cannot withdraw more than available'", async () => {
      await expect(
        swap
          .connect(user1)
          .calculateTokenAmount([MAX_UINT256, String(3e18)], false),
      ).to.be.reverted
    })

    it("Reverts with 'initialDepositRequireAllTokens'", async () => {
      await swapToken.approve(swap.address, String(2e18))
      await swap.removeLiquidity(String(2e18), [0, 0], MAX_UINT256)
      await expect(
        swap
          .connect(user1)
          .addLiquidity([0, String(3e18)], MAX_UINT256, MAX_UINT256),
      ).to.be.revertedWith("initialDepositRequireAllTokens")
    })

    it("Succeeds with expected output amount of pool tokens", async () => {
      const calculatedPoolTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithSlippage = calculatedPoolTokenAmount
        .mul(999)
        .div(1000)

      await swap
        .connect(user1)
        .addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithSlippage,
          MAX_UINT256,
        )

      const actualPoolTokenAmount = await swapToken.balanceOf(user1Address)

      // The actual pool token amount is less than 4e18 due to the imbalance of the underlying tokens
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    it("Succeeds with actual pool token amount being within ±0.1% range of calculated pool token", async () => {
      const calculatedPoolTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithNegativeSlippage =
        calculatedPoolTokenAmount.mul(999).div(1000)

      const calculatedPoolTokenAmountWithPositiveSlippage =
        calculatedPoolTokenAmount.mul(1001).div(1000)

      await snapshotGasCost(
        swap.connect(user1).addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithNegativeSlippage,
          MAX_UINT256,
        )
      )

      const actualPoolTokenAmount = await swapToken.balanceOf(user1Address)

      expect(actualPoolTokenAmount).to.gte(
        calculatedPoolTokenAmountWithNegativeSlippage,
      )

      expect(actualPoolTokenAmount).to.lte(
        calculatedPoolTokenAmountWithPositiveSlippage,
      )
    })

    it("Succeeds with correctly updated tokenBalance after imbalanced deposit", async () => {
      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      // Check updated token balance
      expect(await swap.getTokenBalance(0)).to.eq(BigNumber.from(String(2e18)))
      expect(await swap.getTokenBalance(1)).to.eq(BigNumber.from(String(4e18)))
    })

    it("Reverts when minToMint is not reached due to front running", async () => {
      const calculatedLPTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      // Someone else deposits thus front running user 1's deposit
      await swap.addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      await expect(
        swap
          .connect(user1)
          .addLiquidity(
            [String(1e18), String(3e18)],
            calculatedLPTokenAmountWithSlippage,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when block is mined after deadline", async () => {
      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      await expect(
        swap
          .connect(user1)
          .addLiquidity(
            [String(2e18), String(1e16)],
            0,
            currentTimestamp + 60 * 5,
          ),
      ).to.be.revertedWith("timeout")
    })

    it("Emits addLiquidity event", async () => {
      const calculatedLPTokenAmount = await swap
        .connect(user1)
        .calculateTokenAmount([String(2e18), String(1e16)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      await expect(
        swap
          .connect(user1)
          .addLiquidity(
            [String(2e18), String(1e16)],
            calculatedLPTokenAmountWithSlippage,
            MAX_UINT256,
          ),
      ).to.emit(swap.connect(user1), "AddLiquidity")
    })
  })

  describe("removeLiquidity", () => {
    it("Reverts with 'Cannot exceed total supply'", async () => {
      await expect(
        swap.calculateRemoveLiquidity(MAX_UINT256),
      ).to.be.revertedWith("Cannot exceed total supply")
    })

    it("Reverts because of 'minAmounts must match poolTokens'", async () => {
      await expect(
        swap.removeLiquidity(String(2e18), [0], MAX_UINT256),
      ).to.be.reverted
    })

    it("Succeeds even when contract is paused", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to remove liquidity
      await swapToken.approve(swap.address, String(2e18))
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)

      await swap.removeLiquidity(String(2e18), [0, 0], MAX_UINT256)
      await swap
        .connect(user1)
        .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256)
      expect(await firstToken.balanceOf(swap.address)).to.eq(0)
      expect(await secondToken.balanceOf(swap.address)).to.eq(0)
    })

    it("Succeeds with expected return amounts of underlying tokens", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)

      const [
        firstTokenBalanceBefore,
        secondTokenBalanceBefore,
        poolTokenBalanceBefore,
      ] = await getUserTokenBalances(user1, [
        firstToken,
        secondToken,
        swapToken,
      ])

      expect(poolTokenBalanceBefore).to.eq(
        BigNumber.from("1996275270169644725"),
      )

      const [expectedFirstTokenAmount, expectedSecondTokenAmount] =
        await swap.calculateRemoveLiquidity(poolTokenBalanceBefore)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 1 removes liquidity
      await swapToken
        .connect(user1)
        .approve(swap.address, poolTokenBalanceBefore)
      await swap
        .connect(user1)
        .removeLiquidity(
          poolTokenBalanceBefore,
          [expectedFirstTokenAmount, expectedSecondTokenAmount],
          MAX_UINT256,
        )

      const [firstTokenBalanceAfter, secondTokenBalanceAfter] =
        await getUserTokenBalances(user1, [firstToken, secondToken])

      // Check the actual returned token amounts match the expected amounts
      expect(firstTokenBalanceAfter.sub(firstTokenBalanceBefore)).to.eq(
        expectedFirstTokenAmount,
      )
      expect(secondTokenBalanceAfter.sub(secondTokenBalanceBefore)).to.eq(
        expectedSecondTokenAmount,
      )
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        swap
          .connect(user1)
          .removeLiquidity(
            currentUser1Balance.add(1),
            [MAX_UINT256, MAX_UINT256],
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when minAmounts of underlying tokens are not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      const [expectedFirstTokenAmount, expectedSecondTokenAmount] =
        await swap.calculateRemoveLiquidity(currentUser1Balance)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await swap
        .connect(user2)
        .addLiquidity([String(1e16), String(2e18)], 0, MAX_UINT256)

      // User 1 tries to remove liquidity which get reverted due to front running
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidity(
            currentUser1Balance,
            [expectedFirstTokenAmount, expectedSecondTokenAmount],
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when block is mined after deadline", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidity(
            currentUser1Balance,
            [0, 0],
            currentTimestamp + 60 * 5,
          ),
      ).to.be.revertedWith("timeout")
    })

    it("Emits removeLiquidity event", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      // User 1 tries removes liquidity
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256),
      ).to.emit(swap.connect(user1), "RemoveLiquidity")
    })
  })

  describe("removeLiquidityImbalance", () => {
    it("Reverts when contract is paused", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to initiate imbalanced liquidity withdrawal
      await swapToken.approve(swap.address, MAX_UINT256)
      await swapToken.connect(user1).approve(swap.address, MAX_UINT256)

      await expect(
        swap.removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          MAX_UINT256,
          MAX_UINT256,
        ),
      ).to.be.reverted

      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            MAX_UINT256,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts because of 'Amounts should match pool tokens'", async () => {
      await expect(
        swap.removeLiquidityImbalance([String(1e18)], MAX_UINT256, MAX_UINT256),
      ).to.be.revertedWith("invalidAmountsLength")
    })

    it("Reverts because of 'Cannot withdraw more than available'", async () => {
      await expect(
        swap.removeLiquidityImbalance(
          [MAX_UINT256, MAX_UINT256],
          1,
          MAX_UINT256,
        ),
      ).to.be.reverted
    })

    it("Succeeds with calculated max amount of pool token to be burned (±0.1%)", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await swap.calculateTokenAmount(
        [String(1e18), String(1e16)],
        false,
      )

      // ±0.1% range of pool token to be burned
      const maxPoolTokenAmountToBeBurnedNegativeSlippage =
        maxPoolTokenAmountToBeBurned.mul(1001).div(1000)
      const maxPoolTokenAmountToBeBurnedPositiveSlippage =
        maxPoolTokenAmountToBeBurned.mul(999).div(1000)

      const [
        firstTokenBalanceBefore,
        secondTokenBalanceBefore,
        poolTokenBalanceBefore,
      ] = await getUserTokenBalances(user1, [
        firstToken,
        secondToken,
        swapToken,
      ])

      // User 1 withdraws imbalanced tokens
      await swapToken
        .connect(user1)
        .approve(swap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await swap
        .connect(user1)
        .removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          maxPoolTokenAmountToBeBurnedNegativeSlippage,
          MAX_UINT256,
        )

      const [
        firstTokenBalanceAfter,
        secondTokenBalanceAfter,
        poolTokenBalanceAfter,
      ] = await getUserTokenBalances(user1, [
        firstToken,
        secondToken,
        swapToken,
      ])

      // Check the actual returned token amounts match the requested amounts
      expect(firstTokenBalanceAfter.sub(firstTokenBalanceBefore)).to.eq(
        String(1e18),
      )
      expect(secondTokenBalanceAfter.sub(secondTokenBalanceBefore)).to.eq(
        String(1e16),
      )

      // Check the actual burned pool token amount
      const actualPoolTokenBurned = poolTokenBalanceBefore.sub(
        poolTokenBalanceAfter,
      )

      expect(actualPoolTokenBurned).to.eq(String("1000934178112841889"))
      expect(actualPoolTokenBurned).to.gte(
        maxPoolTokenAmountToBeBurnedPositiveSlippage,
      )
      expect(actualPoolTokenBurned).to.lte(
        maxPoolTokenAmountToBeBurnedNegativeSlippage,
      )
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(2e18), String(1e16)],
            currentUser1Balance.add(1),
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when minAmounts of underlying tokens are not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await swap.calculateTokenAmount(
        [String(1e18), String(1e16)],
        false,
      )

      // Calculate +0.1% of pool token to be burned
      const maxPoolTokenAmountToBeBurnedNegativeSlippage =
        maxPoolTokenAmountToBeBurned.mul(1001).div(1000)

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await swap
        .connect(user2)
        .addLiquidity([String(1e16), String(1e20)], 0, MAX_UINT256)

      // User 1 tries to remove liquidity which get reverted due to front running
      await swapToken
        .connect(user1)
        .approve(swap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            maxPoolTokenAmountToBeBurnedNegativeSlippage,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when block is mined after deadline", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries removing liquidity with deadline of +5 minutes
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            currentUser1Balance,
            currentTimestamp + 60 * 5,
          ),
      ).to.be.revertedWith("timeout")
    })

    it("Emits RemoveLiquidityImbalance event", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      // User 1 removes liquidity
      await swapToken.connect(user1).approve(swap.address, MAX_UINT256)

      await expect(
        swap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            currentUser1Balance,
            MAX_UINT256,
          ),
      ).to.emit(swap.connect(user1), "RemoveLiquidityImbalance")
    })
  })

  describe("removeLiquidityOneToken", () => {
    it("Reverts when contract is paused.", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await swap.pause()

      // Owner and user 1 try to remove liquidity via single token
      await swapToken.approve(swap.address, String(2e18))
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)

      await expect(
        swap.removeLiquidityOneToken(String(2e18), 0, 0, MAX_UINT256),
      ).to.be.reverted
      await expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(currentUser1Balance, 0, 0, MAX_UINT256),
      ).to.be.reverted
    })

    it("Reverts with 'Token index out of range'", async () => {
      await expect(
        swap.calculateRemoveLiquidityOneToken(1, 5),
      ).to.be.revertedWith("indexOutOfRange")
    })

    it("CalculateRemoveLiquidityOneToken return right value", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      expect(
        await swap.calculateRemoveLiquidityOneToken(currentUser1Balance.mul(2), 0),
      ).to.be.eq(BigNumber.from('2999998601797183633'))
    })
    it("Reverts with 'Token not found'", async () => {
      await expect(
        swap.connect(user1).removeLiquidityOneToken(0, 9, 1, MAX_UINT256),
      ).to.be.revertedWith("tokenNotFound")
    })

    it("Succeeds with calculated token amount as minAmount", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount =
        await swap.calculateRemoveLiquidityOneToken(currentUser1Balance, 0)
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 1 initiates one token withdrawal
      const before = await firstToken.balanceOf(user1Address)
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await swap
        .connect(user1)
        .removeLiquidityOneToken(
          currentUser1Balance,
          0,
          calculatedFirstTokenAmount,
          MAX_UINT256,
        )
      const after = await firstToken.balanceOf(user1Address)

      expect(after.sub(before)).to.eq(BigNumber.from("2008990034631583696"))
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(
            currentUser1Balance.add(1),
            0,
            0,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when minAmount of underlying token is not reached due to front running", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount =
        await swap.calculateRemoveLiquidityOneToken(currentUser1Balance, 0)
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 2 adds liquidity before User 1 initiates withdrawal
      await swap
        .connect(user2)
        .addLiquidity([String(1e16), String(1e20)], 0, MAX_UINT256)

      // User 1 initiates one token withdrawal
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(
            currentUser1Balance,
            0,
            calculatedFirstTokenAmount,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when block is mined after deadline", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries removing liquidity with deadline of +5 minutes
      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(
            currentUser1Balance,
            0,
            0,
            currentTimestamp + 60 * 5,
          ),
      ).to.be.revertedWith("timeout")
    })

    it("Emits RemoveLiquidityOne event", async () => {
      // User 1 adds liquidity
      await swap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await swapToken.balanceOf(user1Address)

      await swapToken.connect(user1).approve(swap.address, currentUser1Balance)
      await expect(
        swap
          .connect(user1)
          .removeLiquidityOneToken(currentUser1Balance, 0, 0, MAX_UINT256),
      ).to.emit(swap.connect(user1), "RemoveLiquidityOne")
    })
  })

  describe("flashLoan", () => {
    let borrower: Contract

    beforeEach(async () => {
      borrower = await deployContract(owner, MockStableSwapBorrower)
    })

    it("should revert when contract is paused", async () => {
      await swap.pause()
      await expect(swap.flashLoan(['1', '1'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })

    it("should revert if nothing borrowed", async () => {
      await expect(swap.flashLoan(['0', '0'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })

    it("should revert if payback failed", async () => {
      await expect(swap.flashLoan(['10000', '10000'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })
    
    it("should work if payback funds with fees", async () => {
      await firstToken.approve(borrower.address, MAX_UINT256)
      await secondToken.approve(borrower.address, MAX_UINT256)

      const prevBalances = await swap.getTokenBalances()

      await swap.flashLoan(['100000', '100000'], borrower.address, '0x12', MAX_UINT256)

      const afterBalances = await swap.getTokenBalances()
      expect(afterBalances.map((ab: BigNumber, i: number) => ab.sub(prevBalances[i])))
        .to.deep.eq([BigNumber.from('50'), BigNumber.from('50')])
    })
  })

  describe("swap", () => {
    it("Reverts when contract is paused", async () => {
      // Owner pauses the contract
      await swap.pause()

      // User 1 try to initiate swap
      await expect(swap.connect(user1).swap(0, 1, String(1e16), 0, MAX_UINT256))
        .to.be.reverted
    })

    it("Reverts with 'Token index out of range'", async () => {
      await expect(swap.calculateSwap(0, 9, String(1e17))).to.be.revertedWith(
        "indexOutOfRange",
      )
    })

    it("Reverts with 'Cannot swap more than you own'", async () => {
      await expect(
        swap.connect(user1).swap(0, 1, MAX_UINT256, 0, MAX_UINT256),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
    })

    it("Succeeds with expected swap amounts", async () => {
      // User 1 calculates how much token to receive
      const calculatedSwapReturn = await swap.calculateSwap(0, 1, String(1e17))
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      const [tokenFromBalanceBefore, tokenToBalanceBefore] =
        await getUserTokenBalances(user1, [firstToken, secondToken])

      // User 1 successfully initiates swap
      await swap
        .connect(user1)
        .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256)

      // Check the sent and received amounts are as expected
      const [tokenFromBalanceAfter, tokenToBalanceAfter] =
        await getUserTokenBalances(user1, [firstToken, secondToken])
      expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
        BigNumber.from(String(1e17)),
      )
      expect(tokenToBalanceAfter.sub(tokenToBalanceBefore)).to.eq(
        calculatedSwapReturn,
      )
    })

    it("Reverts when minDy (minimum amount token to receive) is not reached due to front running", async () => {
      // User 1 calculates how much token to receive
      const calculatedSwapReturn = await swap.calculateSwap(0, 1, String(1e17))
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      // User 2 swaps before User 1 does
      await swap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 initiates swap
      await expect(
        swap
          .connect(user1)
          .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256),
      ).to.be.reverted
    })

    it("Succeeds when using lower minDy even when transaction is front-ran", async () => {
      // User 1 calculates how much token to receive with 1% slippage
      const calculatedSwapReturn = await swap.calculateSwap(0, 1, String(1e17))
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      const [tokenFromBalanceBefore, tokenToBalanceBefore] =
        await getUserTokenBalances(user1, [firstToken, secondToken])

      const calculatedSwapReturnWithNegativeSlippage = calculatedSwapReturn
        .mul(99)
        .div(100)

      // User 2 swaps before User 1 does
      await swap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 successfully initiates swap with 1% slippage from initial calculated amount
      await swap
        .connect(user1)
        .swap(
          0,
          1,
          String(1e17),
          calculatedSwapReturnWithNegativeSlippage,
          MAX_UINT256,
        )

      // Check the sent and received amounts are as expected
      const [tokenFromBalanceAfter, tokenToBalanceAfter] =
        await getUserTokenBalances(user1, [firstToken, secondToken])

      expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
        BigNumber.from(String(1e17)),
      )

      const actualReceivedAmount = tokenToBalanceAfter.sub(tokenToBalanceBefore)

      expect(actualReceivedAmount).to.eq(BigNumber.from("99286252365528551"))
      expect(actualReceivedAmount).to.gt(
        calculatedSwapReturnWithNegativeSlippage,
      )
      expect(actualReceivedAmount).to.lt(calculatedSwapReturn)
    })

    it("Reverts when block is mined after deadline", async () => {
      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries swapping with deadline of +5 minutes
      await expect(
        swap
          .connect(user1)
          .swap(0, 1, String(1e17), 0, currentTimestamp + 60 * 5),
      ).to.be.revertedWith("timeout")
    })

    it("Emits TokenExchange event", async () => {
      // User 1 initiates swap
      await expect(
        swap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256),
      ).to.emit(swap, "TokenExchange")
    })
  })

  describe("getVirtualPrice", () => {
    it("Returns expected value after initial deposit", async () => {
      expect(await swap.getVirtualPrice()).to.eq(BigNumber.from(String(1e18)))
    })

    it("Returns expected values after swaps", async () => {
      // With each swap, virtual price will increase due to the fees
      await swap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000050005862349911"),
      )

      await swap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000100104768517937"),
      )
    })

    it("Returns expected values after imbalanced withdrawal", async () => {
      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      await swap
        .connect(user2)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(BigNumber.from(String(1e18)))

      await swapToken.connect(user1).approve(swap.address, String(2e18))
      await swap
        .connect(user1)
        .removeLiquidityImbalance([String(1e18), 0], String(2e18), MAX_UINT256)

      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000100094088440633"),
      )

      await swapToken.connect(user2).approve(swap.address, String(2e18))
      await swap
        .connect(user2)
        .removeLiquidityImbalance([0, String(1e18)], String(2e18), MAX_UINT256)

      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000200154928939884"),
      )
    })

    it("Value is unchanged after balanced deposits", async () => {
      // pool is 1:1 ratio
      expect(await swap.getVirtualPrice()).to.eq(BigNumber.from(String(1e18)))
      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(BigNumber.from(String(1e18)))

      // pool changes to 2:1 ratio, thus changing the virtual price
      await swap
        .connect(user2)
        .addLiquidity([String(2e18), String(0)], 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000167146429977312"),
      )
      // User 2 makes balanced deposit, keeping the ratio 2:1
      await swap
        .connect(user2)
        .addLiquidity([String(2e18), String(1e18)], 0, MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(
        BigNumber.from("1000167146429977312"),
      )
    })

    it("Value is unchanged after balanced withdrawals", async () => {
      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      await swapToken.connect(user1).approve(swap.address, String(1e18))
      await swap
        .connect(user1)
        .removeLiquidity(String(1e18), ["0", "0"], MAX_UINT256)
      expect(await swap.getVirtualPrice()).to.eq(BigNumber.from(String(1e18)))
    })
  })

  describe("setSwapFee", () => {
    it("Emits NewSwapFee event", async () => {
      await expect(swap.setFee(BigNumber.from(1e8), 0)).to.emit(
        swap,
        "NewFee",
      )
    })

    it("Reverts when called by non-owners", async () => {
      await expect(swap.connect(user1).setFee(0, 0)).to.be.reverted
      await expect(swap.connect(user2).setFee(BigNumber.from(1e8), 0)).to.be
        .reverted
    })

    it("Reverts when fee is higher than the limit", async () => {
      await expect(swap.setFee(BigNumber.from(1e8).add(1), 0)).to.be.reverted
    })

    it("Succeeds when fee is within the limit", async () => {
      await swap.setFee(BigNumber.from(1e8), 0)
      expect((await swap.swapStorage()).fee).to.eq(BigNumber.from(1e8))
    })
  })

  describe("setAdminFee", () => {
    it("Emits NewAdminFee event", async () => {
      await expect(swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))).to.emit(
        swap,
        "NewFee",
      )
    })

    it("Reverts when called by non-owners", async () => {
      await expect(swap.connect(user1).setFee(BigNumber.from(SWAP_FEE), 0)).to.be.reverted
      await expect(swap.connect(user2).setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))).to.be
        .reverted
    })

    it("Reverts when adminFee is higher than the limit", async () => {
      await expect(swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10).add(1))).to.be.reverted
    })

    it("Succeeds when adminFee is within the limit", async () => {
      await swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))
      expect((await swap.swapStorage()).adminFee).to.eq(BigNumber.from(1e10))
    })
  })

  describe("getAdminBalance", () => {
    it("Reverts with 'Token index out of range'", async () => {
      await expect(swap.getAdminBalance(3)).to.be.revertedWith(
        "indexOutOfRange",
      )
    })

    it("Is always 0 when adminFee is set to 0", async () => {
      expect(await swap.getAdminBalance(0)).to.eq(0)
      expect(await swap.getAdminBalance(1)).to.eq(0)

      await swap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)

      expect(await swap.getAdminBalance(0)).to.eq(0)
      expect(await swap.getAdminBalance(1)).to.eq(0)
    })

    it("Returns expected amounts after swaps when adminFee is higher than 0", async () => {
      // Sets adminFee to 1% of the swap fees
      await swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await swap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)

      expect(await swap.getAdminBalance(0)).to.eq(0)
      expect(await swap.getAdminBalance(1)).to.eq(String(998024139765))

      // After the first swap, the pool becomes imbalanced; there are more 0th token than 1st token in the pool.
      // Therefore swapping from 1st -> 0th will result in more 0th token returned
      // Also results in higher fees collected on the second swap.

      await swap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)

      expect(await swap.getAdminBalance(0)).to.eq(String(1001973776101))
      expect(await swap.getAdminBalance(1)).to.eq(String(998024139765))
    })
  })

  describe("withdrawAdminFees", () => {
    it("Reverts when called by non-owners", async () => {
      await expect(swap.connect(user1).withdrawAdminFee()).to.be.reverted
      await expect(swap.connect(user2).withdrawAdminFee()).to.be.reverted
    })

    it("Succeeds when there are no fees withdrawn", async () => {
      // Sets adminFee to 1% of the swap fees
      await swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        owner,
        [firstToken, secondToken],
      )

      await swap.withdrawAdminFee()

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        owner,
        [firstToken, secondToken],
      )

      expect(firstTokenBefore).to.eq(firstTokenAfter)
      expect(secondTokenBefore).to.eq(secondTokenAfter)
    })

    it("Succeeds with expected amount of fees withdrawn", async () => {
      // Sets adminFee to 1% of the swap fees
      await swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await swap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)
      await swap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)

      expect(await swap.getAdminBalance(0)).to.eq(String(1001973776101))
      expect(await swap.getAdminBalance(1)).to.eq(String(998024139765))

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        owner,
        [firstToken, secondToken],
      )

      await swap.withdrawAdminFee()

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        owner,
        [firstToken, secondToken],
      )

      expect(firstTokenAfter.sub(firstTokenBefore)).to.eq(String(1001973776101))
      expect(secondTokenAfter.sub(secondTokenBefore)).to.eq(
        String(998024139765),
      )
    })

    it("Withdrawing admin fees has no impact on users' withdrawal", async () => {
      // Sets adminFee to 1% of the swap fees
      await swap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await swap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)

      for (let i = 0; i < 10; i++) {
        await swap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)
        await swap.connect(user2).swap(1, 0, String(1e17), 0, MAX_UINT256)
      }

      await swap.withdrawAdminFee()

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        user1,
        [firstToken, secondToken],
      )

      const user1LPTokenBalance = await swapToken.balanceOf(user1Address)
      await swapToken.connect(user1).approve(swap.address, user1LPTokenBalance)
      await swap
        .connect(user1)
        .removeLiquidity(user1LPTokenBalance, [0, 0], MAX_UINT256)

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        user1,
        [firstToken, secondToken],
      )

      expect(firstTokenAfter.sub(firstTokenBefore)).to.eq(
        BigNumber.from("1000009516257264879"),
      )

      expect(secondTokenAfter.sub(secondTokenBefore)).to.eq(
        BigNumber.from("1000980987206499309"),
      )
    })
  })

  describe("rampA", () => {
    beforeEach(async () => {
      await forceAdvanceOneBlock(provider)
    })

    it("Emits RampA event", async () => {
      await expect(
        swap.rampA(
          100,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        ),
      ).to.emit(swap, "RampA")
    })

    it("Succeeds to ramp upwards", async () => {
      // Create imbalanced pool to measure virtual price change
      // We expect virtual price to increase as A decreases
      await swap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // call rampA(), changing A to 100 within a span of 14 days
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1
      await swap.rampA(100, endTimestamp)

      // +0 seconds since ramp A
      expect(await swap.getA()).to.be.eq(50)
      expect(await swap.getAPrecise()).to.be.eq(5000)
      expect(await swap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)
      expect(await swap.getVirtualPrice()).to.be.eq("1000258443200231295")

      // set timestamp to the end of ramp period
      await setTimestamp(provider, endTimestamp)
      expect(await swap.getA()).to.be.eq(100)
      expect(await swap.getAPrecise()).to.be.eq(10000)
      expect(await swap.getVirtualPrice()).to.be.eq("1000771363829405068")
    })

    it("Succeeds to ramp downwards", async () => {
      // Create imbalanced pool to measure virtual price change
      // We expect virtual price to decrease as A decreases
      await swap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1
      await swap.rampA(25, endTimestamp)

      // +0 seconds since ramp A
      expect(await swap.getA()).to.be.eq(50)
      expect(await swap.getAPrecise()).to.be.eq(5000)
      expect(await swap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await swap.getA()).to.be.eq(47)
      expect(await swap.getAPrecise()).to.be.eq(4794)
      expect(await swap.getVirtualPrice()).to.be.eq("1000115870150391894")

      // set timestamp to the end of ramp period
      await setTimestamp(provider, endTimestamp)
      expect(await swap.getA()).to.be.eq(25)
      expect(await swap.getAPrecise()).to.be.eq(2500)
      expect(await swap.getVirtualPrice()).to.be.eq("998999574522335473")
    })

    it("Reverts when non-owner calls it", async () => {
      await expect(
        swap
          .connect(user1)
          .rampA(55, (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1),
      ).to.be.reverted
    })

    it("Reverts with '< rampDelay'", async () => {
      await swap.rampA(
        55,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )
      await expect(
        swap.rampA(55, (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1),
      ).to.be.revertedWith("< rampDelay")
    })

    it("Reverts with 'outOfRange'", async () => {
      await expect(
        swap.rampA(0, (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1),
      ).to.be.revertedWith("outOfRange")
    })

    it("Reverts with '> maxChange'", async () => {
      await expect(
        swap.rampA(
          501,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        ),
      ).to.be.revertedWith("> maxChange")
    })
  })

  describe("stopRampA", () => {
    it("Emits StopRampA event", async () => {
      // call rampA()
      await swap.rampA(
        100,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100,
      )

      // Stop ramp
      await expect(swap.stopRampA()).to.emit(swap, "StopRampA")
    })

    it("Stop ramp succeeds", async () => {
      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100
      await swap.rampA(100, endTimestamp)

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)

      // Stop ramp
      await swap.stopRampA()
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)

      // set timestamp to endTimestamp
      await setTimestamp(provider, endTimestamp)

      // verify ramp has stopped
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)
    })

    it("Reverts with 'Ramp is already stopped'", async () => {
      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100
      await swap.rampA(100, endTimestamp)

      // set timestamp to +10000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)

      // Stop ramp
      await swap.stopRampA()
      expect(await swap.getA()).to.be.eq(54)
      expect(await swap.getAPrecise()).to.be.eq(5413)

      // check call reverts when ramp is already stopped
      await expect(swap.stopRampA()).to.be.revertedWith(
        "alreadyStopped",
      )
    })
  })

  describe("Check for timestamp manipulations", () => {
    beforeEach(async () => {
      await forceAdvanceOneBlock(provider)
    })

    it("Check for maximum differences in A and virtual price when A is increasing", async () => {
      // Create imbalanced pool to measure virtual price change
      // Sets the pool in 2:1 ratio where firstToken is significantly cheaper than secondToken
      await swap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // Initial A and virtual price
      expect(await swap.getA()).to.be.eq(50)
      expect(await swap.getAPrecise()).to.be.eq(5000)
      expect(await swap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // Start ramp
      await swap.rampA(
        100,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )

      // Malicious miner skips 900 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

      expect(await swap.getA()).to.be.eq(50)
      expect(await swap.getAPrecise()).to.be.eq(5003)
      expect(await swap.getVirtualPrice()).to.be.eq("1000167862696363286")

      // Max increase of A between two blocks
      // 5003 / 5000
      // = 1.0006

      // Max increase of virtual price between two blocks (at 2:1 ratio of tokens, starting A = 50)
      // 1000167862696363286 / 1000167146429977312
      // = 1.00000071615
    })

    it("Check for maximum differences in A and virtual price when A is decreasing", async () => {
      // Create imbalanced pool to measure virtual price change
      // Sets the pool in 2:1 ratio where firstToken is significantly cheaper than secondToken
      await swap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // Initial A and virtual price
      expect(await swap.getA()).to.be.eq(50)
      expect(await swap.getAPrecise()).to.be.eq(5000)
      expect(await swap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // Start ramp
      await swap.rampA(
        25,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )

      // Malicious miner skips 900 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

      expect(await swap.getA()).to.be.eq(49)
      expect(await swap.getAPrecise()).to.be.eq(4999)
      expect(await swap.getVirtualPrice()).to.be.eq("1000166907487883089")

      // Max decrease of A between two blocks
      // 4999 / 5000
      // = 0.9998

      // Max decrease of virtual price between two blocks (at 2:1 ratio of tokens, starting A = 50)
      // 1000166907487883089 / 1000167146429977312
      // = 0.99999976109
    })

    // Below tests try to verify the issues found in Curve Vulnerability Report are resolved.
    // https://medium.com/@peter_4205/curve-vulnerability-report-a1d7630140ec
    // The two cases we are most concerned are:
    //
    // 1. A is ramping up, and the pool is at imbalanced state.
    //
    // Attacker can 'resolve' the imbalance prior to the change of A. Then try to recreate the imbalance after A has
    // changed. Due to the price curve becoming more linear, recreating the imbalance will become a lot cheaper. Thus
    // benefiting the attacker.
    //
    // 2. A is ramping down, and the pool is at balanced state
    //
    // Attacker can create the imbalance in token balances prior to the change of A. Then try to resolve them
    // near 1:1 ratio. Since downward change of A will make the price curve less linear, resolving the token balances
    // to 1:1 ratio will be cheaper. Thus benefiting the attacker
    //
    // For visual representation of how price curves differ based on A, please refer to Figure 1 in the above
    // Curve Vulnerability Report.

    describe("Check for attacks while A is ramping upwards", () => {
      let initialAttackerBalances: BigNumber[] = []
      let initialPoolBalances: BigNumber[] = []
      let attacker: Signer

      beforeEach(async () => {
        // This attack is achieved by creating imbalance in the first block then
        // trading in reverse direction in the second block.
        attacker = user1

        initialAttackerBalances = await getUserTokenBalances(attacker, [
          firstToken,
          secondToken,
        ])

        expect(initialAttackerBalances[0]).to.be.eq(String(1e20))
        expect(initialAttackerBalances[1]).to.be.eq(String(1e20))

        // Start ramp upwards
        await swap.rampA(
          100,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        )
        expect(await swap.getAPrecise()).to.be.eq(5000)

        // Check current pool balances
        initialPoolBalances = [
          await swap.getTokenBalance(0),
          await swap.getTokenBalance(1),
        ]
        expect(initialPoolBalances[0]).to.be.eq(String(1e18))
        expect(initialPoolBalances[1]).to.be.eq(String(1e18))
      })

      describe(
        "When tokens are priced equally: " +
          "attacker creates massive imbalance prior to A change, and resolves it after",
        () => {
          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of firstToken to secondToken, causing massive imbalance in the pool
            await swap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, secondToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 9.085e17 of secondToken
            expect(secondTokenOutput).to.be.eq("908591742545002306")

            // Pool is imbalanced! Now trades from secondToken -> firstToken may be profitable in small sizes
            // firstToken balance in the pool  : 2.00e18
            // secondToken balance in the pool : 9.14e16
            expect(await swap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await swap.getTokenBalance(1)).to.be.eq("91408257454997694")

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed upwards
            // 5000 -> 5003 (0.06%)
            expect(await swap.getAPrecise()).to.be.eq(5003)

            // Trade secondToken to firstToken, taking advantage of the imbalance and change of A
            const balanceBefore = await getUserTokenBalance(
              attacker,
              firstToken,
            )
            await swap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, firstToken)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more firstToken than the start.
            expect(firstTokenOutput).to.be.eq("997214696574405737")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              firstToken,
              secondToken,
            ])

            expect(finalAttackerBalances[0]).to.be.lt(
              initialAttackerBalances[0],
            )
            expect(finalAttackerBalances[1]).to.be.eq(
              initialAttackerBalances[1],
            )
            expect(
              initialAttackerBalances[0].sub(finalAttackerBalances[0]),
            ).to.be.eq("2785303425594263")
            expect(
              initialAttackerBalances[1].sub(finalAttackerBalances[1]),
            ).to.be.eq("0")
            // Attacker lost 2.785e15 firstToken (0.2785% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = []
            finalPoolBalances.push(await swap.getTokenBalance(0))
            finalPoolBalances.push(await swap.getTokenBalance(1))

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "2785303425594263",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 2.785e15 firstToken (0.2785% of firstToken balance)
            // The attack did not benefit the attacker.
          })
        },
      )

      describe(
        "When token price is unequal: " +
          "attacker 'resolves' the imbalance prior to A change, then recreates the imbalance.",
        () => {
          beforeEach(async () => {
            // Set up pool to be imbalanced prior to the attack
            await swap
              .connect(user2)
              .addLiquidity(
                [String(0), String(2e18)],
                0,
                (await getCurrentBlockTimestamp(provider)) + 60,
              )

            // Check current pool balances
            initialPoolBalances = [
              await swap.getTokenBalance(0),
              await swap.getTokenBalance(1),
            ]
            expect(initialPoolBalances[0]).to.be.eq(String(1e18))
            expect(initialPoolBalances[1]).to.be.eq(String(3e18))
          })

          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of firstToken to secondToken, resolving imbalance in the pool
            await swap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, secondToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 1.012e18 of secondToken
            // Because the pool was imbalanced in the beginning, this trade results in more than 1e18 secondToken
            expect(secondTokenOutput).to.be.eq("1011933251060681353")

            // Pool is now almost balanced!
            // firstToken balance in the pool  : 2.000e18
            // secondToken balance in the pool : 1.988e18
            expect(await swap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await swap.getTokenBalance(1)).to.be.eq(
              "1988066748939318647",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed upwards
            // 5000 -> 5003 (0.06%)
            expect(await swap.getAPrecise()).to.be.eq(5003)

            // Trade secondToken to firstToken, taking advantage of the imbalance and sudden change of A
            const balanceBefore = await getUserTokenBalance(
              attacker,
              firstToken,
            )
            await swap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, firstToken)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the attacker leaves with more firstToken than the start.
            expect(firstTokenOutput).to.be.eq("998017518949630644")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              firstToken,
              secondToken,
            ])

            expect(finalAttackerBalances[0]).to.be.lt(
              initialAttackerBalances[0],
            )
            expect(finalAttackerBalances[1]).to.be.eq(
              initialAttackerBalances[1],
            )
            expect(
              initialAttackerBalances[0].sub(finalAttackerBalances[0]),
            ).to.be.eq("1982481050369356")
            expect(
              initialAttackerBalances[1].sub(finalAttackerBalances[1]),
            ).to.be.eq("0")
            // Attacker lost 1.982e15 firstToken (0.1982% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = []
            finalPoolBalances.push(await swap.getTokenBalance(0))
            finalPoolBalances.push(await swap.getTokenBalance(1))

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "1982481050369356",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 1.982e15 firstToken (0.1982% of firstToken balance)
            // The attack did not benefit the attacker.
          })
        },
      )
    })

    describe("Check for attacks while A is ramping downwards", () => {
      let initialAttackerBalances: BigNumber[] = []
      let initialPoolBalances: BigNumber[] = []
      let attacker: Signer

      beforeEach(async () => {
        // Set up the downward ramp A
        attacker = user1

        initialAttackerBalances = await getUserTokenBalances(attacker, [
          firstToken,
          secondToken,
        ])

        expect(initialAttackerBalances[0]).to.be.eq(String(1e20))
        expect(initialAttackerBalances[1]).to.be.eq(String(1e20))

        // Start ramp downwards
        await swap.rampA(
          25,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        )
        expect(await swap.getAPrecise()).to.be.eq(5000)

        // Check current pool balances
        initialPoolBalances = [
          await swap.getTokenBalance(0),
          await swap.getTokenBalance(1),
        ]
        expect(initialPoolBalances[0]).to.be.eq(String(1e18))
        expect(initialPoolBalances[1]).to.be.eq(String(1e18))
      })

      describe(
        "When tokens are priced equally: " +
          "attacker creates massive imbalance prior to A change, and resolves it after",
        () => {
          // This attack is achieved by creating imbalance in the first block then
          // trading in reverse direction in the second block.

          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of firstToken to secondToken, causing massive imbalance in the pool
            await swap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, secondToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 9.085e17 of secondToken
            expect(secondTokenOutput).to.be.eq("908591742545002306")

            // Pool is imbalanced! Now trades from secondToken -> firstToken may be profitable in small sizes
            // firstToken balance in the pool  : 2.00e18
            // secondToken balance in the pool : 9.14e16
            expect(await swap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await swap.getTokenBalance(1)).to.be.eq("91408257454997694")

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed downwards
            expect(await swap.getAPrecise()).to.be.eq(4999)

            const balanceBefore = await getUserTokenBalance(
              attacker,
              firstToken,
            )
            await swap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, firstToken)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more firstToken than the start.
            expect(firstTokenOutput).to.be.eq("997276754500361021")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              firstToken,
              secondToken,
            ])

            // Check for attacker's balance changes
            expect(finalAttackerBalances[0]).to.be.lt(
              initialAttackerBalances[0],
            )
            expect(finalAttackerBalances[1]).to.be.eq(
              initialAttackerBalances[1],
            )
            expect(
              initialAttackerBalances[0].sub(finalAttackerBalances[0]),
            ).to.be.eq("2723245499638979")
            expect(
              initialAttackerBalances[1].sub(finalAttackerBalances[1]),
            ).to.be.eq("0")
            // Attacker lost 2.723e15 firstToken (0.2723% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = [
              await swap.getTokenBalance(0),
              await swap.getTokenBalance(1),
            ]

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "2723245499638979",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 2.723e15 firstToken (0.2723% of firstToken balance)
            // The attack did not benefit the attacker.
          })
        },
      )

      describe(
        "When token price is unequal: " +
          "attacker 'resolves' the imbalance prior to A change, then recreates the imbalance.",
        () => {
          beforeEach(async () => {
            // Set up pool to be imbalanced prior to the attack
            await swap
              .connect(user2)
              .addLiquidity(
                [String(0), String(2e18)],
                0,
                (await getCurrentBlockTimestamp(provider)) + 60,
              )

            // Check current pool balances
            initialPoolBalances = [
              await swap.getTokenBalance(0),
              await swap.getTokenBalance(1),
            ]
            expect(initialPoolBalances[0]).to.be.eq(String(1e18))
            expect(initialPoolBalances[1]).to.be.eq(String(3e18))
          })

          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of firstToken to secondToken, resolving imbalance in the pool
            await swap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, secondToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 1.012e18 of secondToken
            // Because the pool was imbalanced in the beginning, this trade results in more than 1e18 secondToken
            expect(secondTokenOutput).to.be.eq("1011933251060681353")

            // Pool is now almost balanced!
            // firstToken balance in the pool  : 2.000e18
            // secondToken balance in the pool : 1.988e18
            expect(await swap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await swap.getTokenBalance(1)).to.be.eq(
              "1988066748939318647",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed downwards
            expect(await swap.getAPrecise()).to.be.eq(4999)

            const balanceBefore = await getUserTokenBalance(
              attacker,
              firstToken,
            )
            await swap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, firstToken)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more firstToken than the start.
            expect(firstTokenOutput).to.be.eq("998007711333645455")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              firstToken,
              secondToken,
            ])

            // Check for attacker's balance changes
            expect(finalAttackerBalances[0]).to.be.lt(
              initialAttackerBalances[0],
            )
            expect(finalAttackerBalances[1]).to.be.eq(
              initialAttackerBalances[1],
            )
            expect(
              initialAttackerBalances[0].sub(finalAttackerBalances[0]),
            ).to.be.eq("1992288666354545")
            expect(
              initialAttackerBalances[1].sub(finalAttackerBalances[1]),
            ).to.be.eq("0")
            // Attacker lost 1.992e15 firstToken (0.1992% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = [
              await swap.getTokenBalance(0),
              await swap.getTokenBalance(1),
            ]

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "1992288666354545",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 1.992e15 firstToken (0.1992% of firstToken balance)
            // The attack did not benefit the attacker.
          })
        },
      )
    })
  })
})
