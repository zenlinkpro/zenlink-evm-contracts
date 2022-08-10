import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, Contract, ContractFactory, Signer, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import TestERC20 from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import StableSwap from '../build/contracts/stableswap/StableSwap.sol/StableSwap.json'
import StableSwapStorage from '../build/contracts/stableswap/StableSwapStorage.sol/StableSwapStorage.json'
import MetaSwap from '../build/contracts/stableswap/MetaSwap.sol/MetaSwap.json'
import MetaSwapStorage from '../build/contracts/stableswap/MetaSwapStorage.sol/MetaSwapStorage.json'
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

describe('MetaSwap', async () => {
  let signers: Array<Wallet>
  let baseSwap: Contract
  let metaSwap: Contract
  let baseLPToken: Contract
  let metaLPToken: Contract
  let dai: Contract
  let usdc: Contract
  let usdt: Contract
  let frax: Contract
  let owner: Wallet
  let user1: Wallet
  let user2: Wallet
  let ownerAddress: string
  let user1Address: string
  let user2Address: string

  // Test Values
  const INITIAL_A_VALUE = 50
  const SWAP_FEE = 1e7
  const LP_TOKEN_NAME = "Test LP Token Name"
  const LP_TOKEN_SYMBOL = "TESTLP"

  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 99999999999
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

    dai = await deployContract(
      owner,
      TestERC20,
      ['DAI', 'DAI', '18', '0']
    )
    usdc = await deployContract(
      owner,
      TestERC20,
      ['USDC', 'USDC', '6', '0']
    )
    usdt = await deployContract(
      owner,
      TestERC20,
      ['USDT', 'USDT', '6', '0']
    )
    frax = await deployContract(
      owner,
      TestERC20,
      ['FRAX', 'FRAX', '18', '0']
    )

    const stableSwapStorageContract = await deployContract(owner, StableSwapStorage)
    const stableSwapFactory = (await ethers.getContractFactory(
      StableSwap.abi,
      linkBytecode(StableSwap, {
        'StableSwapStorage': stableSwapStorageContract.address
      }),
      owner,
    )) as ContractFactory
    baseSwap = await stableSwapFactory.deploy()
    
    await baseSwap.initialize(
      [dai.address, usdc.address, usdt.address],
      [18, 6, 6],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      200,
      4e6,
      0,
      owner.address
    )

    baseLPToken = await ethers.getContractAt(
      'LPToken',
      (await baseSwap.swapStorage()).lpToken,
      owner
    )

    // Mint tokens
    await asyncForEach(
      [ownerAddress, user1Address, user2Address],
      async (address) => {
        await dai.setBalance(address, BigNumber.from(10).pow(18).mul(100000))
        await usdc.setBalance(address, BigNumber.from(10).pow(6).mul(100000))
        await usdt.setBalance(address, BigNumber.from(10).pow(6).mul(100000))
        await frax.setBalance(address, BigNumber.from(10).pow(18).mul(100000))
      }
    )

    const metaSwapStorageContract = await deployContract(owner, MetaSwapStorage)
    const metaSwapFactory = (await ethers.getContractFactory(
      MetaSwap.abi,
      linkBytecode(MetaSwap, {
        'StableSwapStorage': stableSwapStorageContract.address,
        'MetaSwapStorage': metaSwapStorageContract.address
      }),
      owner,
    )) as ContractFactory
    metaSwap = await metaSwapFactory.deploy()

    // Set approvals
    await asyncForEach([owner, user1, user2], async (signer) => {
      await frax.connect(signer).approve(metaSwap.address, MAX_UINT256)
      await dai.connect(signer).approve(metaSwap.address, MAX_UINT256)
      await usdc.connect(signer).approve(metaSwap.address, MAX_UINT256)
      await usdt.connect(signer).approve(metaSwap.address, MAX_UINT256)
      await dai.connect(signer).approve(baseSwap.address, MAX_UINT256)
      await usdc.connect(signer).approve(baseSwap.address, MAX_UINT256)
      await usdt.connect(signer).approve(baseSwap.address, MAX_UINT256)
      await baseLPToken.connect(signer).approve(metaSwap.address, MAX_UINT256)

      // Add some liquidity to the base pool
      await baseSwap
        .connect(signer)
        .addLiquidity(
          [String(1e20), String(1e8), String(1e8)],
          0,
          MAX_UINT256
        )
    })

    // Initialize meta swap pool
    // Manually overload the signature
    await metaSwap.initializeMetaSwap(
      [frax.address, baseLPToken.address],
      [18, 18],
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A_VALUE,
      SWAP_FEE,
      0,
      owner.address,
      baseSwap.address
    )

    metaLPToken = await ethers.getContractAt(
      'LPToken',
      (await metaSwap.swapStorage()).lpToken,
      owner
    )

    // Add liquidity to the meta swap pool
    await metaSwap.addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
    
    expect(await frax.balanceOf(metaSwap.address)).to.eq(String(1e18))
    expect(await baseLPToken.balanceOf(metaSwap.address)).to.eq(String(1e18))
  }

  beforeEach(async () => {
    await setupTest()
  })

  describe("swapStorage", () => {
    describe("lpToken", async () => {
      it("Returns correct lpTokenName", async () => {
        expect(await metaLPToken.name()).to.eq(LP_TOKEN_NAME)
      })

      it("Returns correct lpTokenSymbol", async () => {
        expect(await metaLPToken.symbol()).to.eq(LP_TOKEN_SYMBOL)
      })
    })

    describe("A", async () => {
      it("Returns correct A value", async () => {
        expect(await metaSwap.getA()).to.eq(INITIAL_A_VALUE)
        expect(await metaSwap.getAPrecise()).to.eq(INITIAL_A_VALUE * 100)
      })
    })

    describe("fee", async () => {
      it("Returns correct fee value", async () => {
        expect((await metaSwap.swapStorage()).fee).to.eq(SWAP_FEE)
      })
    })

    describe("adminFee", async () => {
      it("Returns correct adminFee value", async () => {
        expect((await metaSwap.swapStorage()).adminFee).to.eq(0)
      })
    })
  })

  describe("getToken", () => {
    it("Returns correct addresses of pooled tokens", async () => {
      expect(await metaSwap.getToken(0)).to.eq(frax.address)
      expect(await metaSwap.getToken(1)).to.eq(baseLPToken.address)
    })

    it("Reverts when index is out of range", async () => {
      await expect(metaSwap.getToken(2)).to.be.reverted
    })
  })

  describe("getTokenIndex", () => {
    it("Returns correct token indexes", async () => {
      expect(await metaSwap.getTokenIndex(frax.address)).to.be.eq(0)
      expect(await metaSwap.getTokenIndex(baseLPToken.address)).to.be.eq(1)
    })

    it("Reverts when token address is not found", async () => {
      await expect(metaSwap.getTokenIndex(ZERO_ADDRESS)).to.be.revertedWith(
        "tokenNotFound",
      )
    })
  })

  describe("getTokenBalance", () => {
    it("Returns correct balances of pooled tokens", async () => {
      expect(await metaSwap.getTokenBalance(0)).to.eq(
        BigNumber.from(String(1e18)),
      )
      expect(await metaSwap.getTokenBalance(1)).to.eq(
        BigNumber.from(String(1e18)),
      )
    })

    it("Reverts when index is out of range", async () => {
      await expect(metaSwap.getTokenBalance(2)).to.be.reverted
    })
  })

  describe("getA", () => {
    it("Returns correct value", async () => {
      expect(await metaSwap.getA()).to.eq(INITIAL_A_VALUE)
    })
  })

  describe("addLiquidity", () => {
    it("Reverts when contract is paused", async () => {
      await metaSwap.pause()

      await expect(
        metaSwap
          .connect(user1)
          .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256),
      ).to.be.reverted

      // unpause
      await metaSwap.unpause()

      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    it("Reverts with 'Amounts must match pooled tokens'", async () => {
      await expect(
        metaSwap.connect(user1).addLiquidity([String(1e16)], 0, MAX_UINT256),
      ).to.be.revertedWith("Amounts must match pooled tokens")
    })

    it("Reverts with 'Cannot withdraw more than available'", async () => {
      await expect(
        metaSwap
          .connect(user1)
          .calculateTokenAmount([MAX_UINT256, String(3e18)], false),
      ).to.be.reverted
    })

    it("Reverts with 'Must supply all tokens in pool'", async () => {
      await metaLPToken.approve(metaSwap.address, String(2e18))
      await metaSwap.removeLiquidity(String(2e18), [0, 0], MAX_UINT256)
      await expect(
        metaSwap
          .connect(user1)
          .addLiquidity([0, String(3e18)], MAX_UINT256, MAX_UINT256),
      ).to.be.revertedWith("Must supply all tokens in pool")
    })

    it("Succeeds with expected output amount of pool tokens", async () => {
      const calculatedPoolTokenAmount = await metaSwap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithSlippage = calculatedPoolTokenAmount
        .mul(999)
        .div(1000)

      await metaSwap
        .connect(user1)
        .addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithSlippage,
          MAX_UINT256,
        )

      const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

      // The actual pool token amount is less than 4e18 due to the imbalance of the underlying tokens
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    it("Succeeds with actual pool token amount being within ±0.1% range of calculated pool token", async () => {
      const calculatedPoolTokenAmount = await metaSwap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedPoolTokenAmountWithNegativeSlippage =
        calculatedPoolTokenAmount.mul(999).div(1000)

      const calculatedPoolTokenAmountWithPositiveSlippage =
        calculatedPoolTokenAmount.mul(1001).div(1000)

      await metaSwap
        .connect(user1)
        .addLiquidity(
          [String(1e18), String(3e18)],
          calculatedPoolTokenAmountWithNegativeSlippage,
          MAX_UINT256,
        )

      const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

      expect(actualPoolTokenAmount).to.gte(
        calculatedPoolTokenAmountWithNegativeSlippage,
      )

      expect(actualPoolTokenAmount).to.lte(
        calculatedPoolTokenAmountWithPositiveSlippage,
      )
    })

    it("Succeeds with correctly updated tokenBalance after imbalanced deposit", async () => {
      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      // Check updated token balance
      expect(await metaSwap.getTokenBalance(0)).to.eq(
        BigNumber.from(String(2e18)),
      )
      expect(await metaSwap.getTokenBalance(1)).to.eq(
        BigNumber.from(String(4e18)),
      )
    })

    it("Returns correct minted lpToken amount", async () => {
      const mintedAmount = await metaSwap
        .connect(user1)
        .callStatic.addLiquidity([String(1e18), String(2e18)], 0, MAX_UINT256)

      expect(mintedAmount).to.eq("2997459774673651937")
    })

    it("Reverts when minToMint is not reached due to front running", async () => {
      const calculatedLPTokenAmount = await metaSwap
        .connect(user1)
        .calculateTokenAmount([String(1e18), String(3e18)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      // Someone else deposits thus front running user 1's deposit
      await metaSwap.addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      await expect(
        metaSwap
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
        metaSwap
          .connect(user1)
          .addLiquidity(
            [String(2e18), String(1e16)],
            0,
            currentTimestamp + 60 * 5,
          ),
      ).to.be.revertedWith("timeout")
    })

    it("Emits addLiquidity event", async () => {
      const calculatedLPTokenAmount = await metaSwap
        .connect(user1)
        .calculateTokenAmount([String(2e18), String(1e16)], true)

      const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
        .mul(999)
        .div(1000)

      await expect(
        metaSwap
          .connect(user1)
          .addLiquidity(
            [String(2e18), String(1e16)],
            calculatedLPTokenAmountWithSlippage,
            MAX_UINT256,
          ),
      ).to.emit(metaSwap.connect(user1), "AddLiquidity")
    })
  })

  describe("removeLiquidity", () => {
    it("Reverts with 'Cannot exceed total supply'", async () => {
      await expect(
        metaSwap.calculateRemoveLiquidity(MAX_UINT256),
      ).to.be.revertedWith("Cannot exceed total supply")
    })

    it("Reverts with 'minAmounts must match poolTokens'", async () => {
      await expect(
        metaSwap.removeLiquidity(String(2e18), [0], MAX_UINT256),
      ).to.be.reverted
    })

    it("Succeeds even when contract is paused", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await metaSwap.pause()

      // Owner and user 1 try to remove liquidity
      await metaLPToken.approve(metaSwap.address, String(2e18))
      await metaLPToken.connect(user1).approve(metaSwap.address, currentUser1Balance)

      await metaSwap.removeLiquidity(String(2e18), [0, 0], MAX_UINT256)
      await metaSwap
        .connect(user1)
        .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256)
      expect(await frax.balanceOf(metaSwap.address)).to.eq(0)
      expect(await baseLPToken.balanceOf(metaSwap.address)).to.eq(0)
    })

    it("Succeeds with expected return amounts of underlying tokens", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)

      const [
        firstTokenBalanceBefore,
        secondTokenBalanceBefore,
        poolTokenBalanceBefore,
      ] = await getUserTokenBalances(user1, [frax, baseLPToken, metaLPToken])

      expect(poolTokenBalanceBefore).to.eq(
        BigNumber.from("1996275270169644725"),
      )

      const [expectedFirstTokenAmount, expectedSecondTokenAmount] =
        await metaSwap.calculateRemoveLiquidity(poolTokenBalanceBefore)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 1 removes liquidity
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, poolTokenBalanceBefore)
      await metaSwap
        .connect(user1)
        .removeLiquidity(
          poolTokenBalanceBefore,
          [expectedFirstTokenAmount, expectedSecondTokenAmount],
          MAX_UINT256,
        )

      const [firstTokenBalanceAfter, secondTokenBalanceAfter] =
        await getUserTokenBalances(user1, [frax, baseLPToken])

      // Check the actual returned token amounts match the expected amounts
      expect(firstTokenBalanceAfter.sub(firstTokenBalanceBefore)).to.eq(
        expectedFirstTokenAmount,
      )
      expect(secondTokenBalanceAfter.sub(secondTokenBalanceBefore)).to.eq(
        expectedSecondTokenAmount,
      )
    })

    it("Returns correct amounts of received tokens", async () => {
      const metaLPTokenBalance = await metaLPToken.balanceOf(ownerAddress)

      await metaLPToken.approve(metaSwap.address, MAX_UINT256)
      const removedTokenAmounts = await metaSwap.callStatic.removeLiquidity(
        metaLPTokenBalance,
        [0, 0],
        MAX_UINT256,
      )

      expect(removedTokenAmounts[0]).to.eq("1000000000000000000")
      expect(removedTokenAmounts[1]).to.eq("1000000000000000000")
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      const [expectedFirstTokenAmount, expectedSecondTokenAmount] =
        await metaSwap.calculateRemoveLiquidity(currentUser1Balance)

      expect(expectedFirstTokenAmount).to.eq(
        BigNumber.from("1498601924450190405"),
      )
      expect(expectedSecondTokenAmount).to.eq(
        BigNumber.from("504529314564897436"),
      )

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await metaSwap
        .connect(user2)
        .addLiquidity([String(1e16), String(2e18)], 0, MAX_UINT256)

      // User 1 tries to remove liquidity which get reverted due to front running
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries removing liquidity with deadline of +5 minutes
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      // User 1 tries removes liquidity
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256),
      ).to.emit(metaSwap.connect(user1), "RemoveLiquidity")
    })
  })

  describe("removeLiquidityImbalance", () => {
    it("Reverts when contract is paused", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await metaSwap.pause()

      // Owner and user 1 try to initiate imbalanced liquidity withdrawal
      await metaLPToken.approve(metaSwap.address, MAX_UINT256)
      await metaLPToken.connect(user1).approve(metaSwap.address, MAX_UINT256)

      await expect(
        metaSwap.removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          MAX_UINT256,
          MAX_UINT256,
        ),
      ).to.be.reverted

      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            MAX_UINT256,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts with 'Amounts should match pool tokens'", async () => {
      await expect(
        metaSwap.removeLiquidityImbalance(
          [String(1e18)],
          MAX_UINT256,
          MAX_UINT256,
        ),
      ).to.be.revertedWith("Amounts should match pool tokens")
    })

    it("Reverts with 'Cannot withdraw more than available'", async () => {
      await expect(
        metaSwap.removeLiquidityImbalance(
          [MAX_UINT256, MAX_UINT256],
          1,
          MAX_UINT256,
        ),
      ).to.be.reverted
    })

    it("Succeeds with calculated max amount of pool token to be burned (±0.1%)", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await metaSwap.calculateTokenAmount(
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
      ] = await getUserTokenBalances(user1, [frax, baseLPToken, metaLPToken])

      // User 1 withdraws imbalanced tokens
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await metaSwap
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
      ] = await getUserTokenBalances(user1, [frax, baseLPToken, metaLPToken])

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

    it("Returns correct amount of burned lpToken", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      // User 1 removes liquidity
      await metaLPToken.connect(user1).approve(metaSwap.address, MAX_UINT256)

      const burnedLPTokenAmount = await metaSwap
        .connect(user1)
        .callStatic.removeLiquidityImbalance(
          [String(1e18), String(1e16)],
          currentUser1Balance,
          MAX_UINT256,
        )

      expect(burnedLPTokenAmount).eq("1000934178112841889")
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            currentUser1Balance.add(1),
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Reverts when minAmounts of underlying tokens are not reached due to front running", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates amount of pool token to be burned
      const maxPoolTokenAmountToBeBurned = await metaSwap.calculateTokenAmount(
        [String(1e18), String(1e16)],
        false,
      )

      // Calculate +0.1% of pool token to be burned
      const maxPoolTokenAmountToBeBurnedNegativeSlippage =
        maxPoolTokenAmountToBeBurned.mul(1001).div(1000)

      // User 2 adds liquidity, which leads to change in balance of underlying tokens
      await metaSwap
        .connect(user2)
        .addLiquidity([String(1e16), String(1e20)], 0, MAX_UINT256)

      // User 1 tries to remove liquidity which get reverted due to front running
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, maxPoolTokenAmountToBeBurnedNegativeSlippage)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries removing liquidity with deadline of +5 minutes
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      // User 1 removes liquidity
      await metaLPToken.connect(user1).approve(metaSwap.address, MAX_UINT256)

      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidityImbalance(
            [String(1e18), String(1e16)],
            currentUser1Balance,
            MAX_UINT256,
          ),
      ).to.emit(metaSwap.connect(user1), "RemoveLiquidityImbalance")
    })
  })

  describe("removeLiquidityOneToken", () => {
    it("Reverts when contract is paused.", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // Owner pauses the contract
      await metaSwap.pause()

      // Owner and user 1 try to remove liquidity via single token
      await metaLPToken.approve(metaSwap.address, String(2e18))
      await metaLPToken.connect(user1).approve(metaSwap.address, currentUser1Balance)

      await expect(
        metaSwap.removeLiquidityOneToken(String(2e18), 0, 0, MAX_UINT256),
      ).to.be.reverted
      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidityOneToken(currentUser1Balance, 0, 0, MAX_UINT256),
      ).to.be.reverted
    })

    it("Reverts with 'Token index out of range'", async () => {
      await expect(
        metaSwap.calculateRemoveLiquidityOneToken(1, 5),
      ).to.be.revertedWith("Token index out of range")
    })

    it("Reverts with 'Withdraw exceeds available'", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        metaSwap.calculateRemoveLiquidityOneToken(
          currentUser1Balance.mul(2),
          0,
        ),
      ).to.be.revertedWith("Withdraw exceeds available")
    })

    it("Reverts with 'Token not found'", async () => {
      await expect(
        metaSwap.connect(user1).removeLiquidityOneToken(0, 9, 1, MAX_UINT256),
      ).to.be.revertedWith("Token not found")
    })

    it("Succeeds with calculated token amount as minAmount", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount =
        await metaSwap.calculateRemoveLiquidityOneToken(currentUser1Balance, 0)
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 1 initiates one token withdrawal
      const before = await frax.balanceOf(user1Address)
      await metaLPToken.connect(user1).approve(metaSwap.address, currentUser1Balance)
      await metaSwap
        .connect(user1)
        .removeLiquidityOneToken(
          currentUser1Balance,
          0,
          calculatedFirstTokenAmount,
          MAX_UINT256,
        )
      const after = await frax.balanceOf(user1Address)

      expect(after.sub(before)).to.eq(BigNumber.from("2008990034631583696"))
    })

    it("Returns correct amount of received token", async () => {
      await metaLPToken.approve(metaSwap.address, MAX_UINT256)
      const removedTokenAmount =
        await metaSwap.callStatic.removeLiquidityOneToken(
          String(1e18),
          0,
          0,
          MAX_UINT256,
        )
      expect(removedTokenAmount).to.eq("954404308901884931")
    })

    it("Reverts when user tries to burn more LP tokens than they own", async () => {
      // User 1 adds liquidity
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)
      expect(currentUser1Balance).to.eq(BigNumber.from("1996275270169644725"))

      // User 1 calculates the amount of underlying token to receive.
      const calculatedFirstTokenAmount =
        await metaSwap.calculateRemoveLiquidityOneToken(currentUser1Balance, 0)
      expect(calculatedFirstTokenAmount).to.eq(
        BigNumber.from("2008990034631583696"),
      )

      // User 2 adds liquidity before User 1 initiates withdrawal
      await metaSwap
        .connect(user2)
        .addLiquidity([String(1e16), String(1e20)], 0, MAX_UINT256)

      // User 1 initiates one token withdrawal
      await metaLPToken.connect(user1).approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries removing liquidity with deadline of +5 minutes
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
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
      await metaSwap
        .connect(user1)
        .addLiquidity([String(2e18), String(1e16)], 0, MAX_UINT256)
      const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, currentUser1Balance)
      await expect(
        metaSwap
          .connect(user1)
          .removeLiquidityOneToken(currentUser1Balance, 0, 0, MAX_UINT256),
      ).to.emit(metaSwap.connect(user1), "RemoveLiquidityOne")
    })
  })

  describe("flashLoan", () => {
    let borrower: Contract

    beforeEach(async () => {
      borrower = await deployContract(owner, MockStableSwapBorrower)
    })

    it("should revert when contract is paused", async () => {
      await metaSwap.pause()
      await expect(metaSwap.flashLoan(['1', '1'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })

    it("should revert if nothing borrowed", async () => {
      await expect(metaSwap.flashLoan(['0', '0'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })

    it("should revert if payback failed", async () => {
      await expect(metaSwap.flashLoan(['10000', '10000'], borrower.address, '0x12', MAX_UINT256))
        .to.be.reverted
    })

    it("should work if payback funds with fees", async () => {
      await frax.approve(borrower.address, MAX_UINT256)
      await baseLPToken.approve(borrower.address, MAX_UINT256)

      const prevBalances = await metaSwap.getTokenBalances()

      await metaSwap.flashLoan(['100000', '100000'], borrower.address, '0x12', MAX_UINT256)

      const afterBalances = await metaSwap.getTokenBalances()
      expect(afterBalances.map((ab: BigNumber, i: number) => ab.sub(prevBalances[i])))
        .to.deep.eq([BigNumber.from('50'), BigNumber.from('50')])
    })
  })

  describe("swap", () => {
    it("Reverts when contract is paused", async () => {
      // Owner pauses the contract
      await metaSwap.pause()

      // User 1 try to initiate swap
      await expect(
        metaSwap.connect(user1).swap(0, 1, String(1e16), 0, MAX_UINT256),
      ).to.be.reverted
    })

    it("Reverts with 'Token index out of range'", async () => {
      await expect(
        metaSwap.calculateSwap(0, 9, String(1e17)),
      ).to.be.revertedWith("Token index out of range")
    })

    it("Reverts with 'Cannot swap more than you own'", async () => {
      await expect(
        metaSwap.connect(user1).swap(0, 1, MAX_UINT256, 0, MAX_UINT256),
      ).to.be.revertedWith("Cannot swap more than you own")
    })

    it("Succeeds with expected swap amounts", async () => {
      // User 1 calculates how much token to receive
      const calculatedSwapReturn = await metaSwap.calculateSwap(
        0,
        1,
        String(1e17),
      )
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      const [tokenFromBalanceBefore, tokenToBalanceBefore] =
        await getUserTokenBalances(user1, [frax, baseLPToken])

      // User 1 successfully initiates swap
      await metaSwap
        .connect(user1)
        .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256)

      // Check the sent and received amounts are as expected
      const [tokenFromBalanceAfter, tokenToBalanceAfter] =
        await getUserTokenBalances(user1, [frax, baseLPToken])
      expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
        BigNumber.from(String(1e17)),
      )
      expect(tokenToBalanceAfter.sub(tokenToBalanceBefore)).to.eq(
        calculatedSwapReturn,
      )
    })

    it("Reverts when minDy (minimum amount token to receive) is not reached due to front running", async () => {
      // User 1 calculates how much token to receive
      const calculatedSwapReturn = await metaSwap.calculateSwap(
        0,
        1,
        String(1e17),
      )
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      // User 2 swaps before User 1 does
      await metaSwap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 initiates swap
      await expect(
        metaSwap
          .connect(user1)
          .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256),
      ).to.be.reverted
    })

    it("Succeeds when using lower minDy even when transaction is front-ran", async () => {
      // User 1 calculates how much token to receive with 1% slippage
      const calculatedSwapReturn = await metaSwap.calculateSwap(
        0,
        1,
        String(1e17),
      )
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99702611562565289"))

      const [tokenFromBalanceBefore, tokenToBalanceBefore] =
        await getUserTokenBalances(user1, [frax, baseLPToken])

      const calculatedSwapReturnWithNegativeSlippage = calculatedSwapReturn
        .mul(99)
        .div(100)

      // User 2 swaps before User 1 does
      await metaSwap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 successfully initiates swap with 1% slippage from initial calculated amount
      await metaSwap
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
        await getUserTokenBalances(user1, [frax, baseLPToken])

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

    it("Returns correct amount of received token", async () => {
      const swapReturnAmount = await metaSwap.callStatic.swap(
        0,
        1,
        String(1e18),
        0,
        MAX_UINT256,
      )
      expect(swapReturnAmount).to.eq("908591742545002306")
    })

    it("Reverts when block is mined after deadline", async () => {
      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries swapping with deadline of +5 minutes
      await expect(
        metaSwap
          .connect(user1)
          .swap(0, 1, String(1e17), 0, currentTimestamp + 60 * 5),
      ).to.be.revertedWith("timeout")
    })

    it("Emits TokenSwap event", async () => {
      // User 1 initiates swap
      await expect(
        metaSwap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256),
      ).to.emit(metaSwap, "TokenExchange")
    })
  })

  describe("swapUnderlying", () => {
    it("Reverts when contract is paused", async () => {
      // Owner pauses the contract
      await metaSwap.pause()

      // User 1 try to initiate swap
      await expect(
        metaSwap
          .connect(user1)
          .swapUnderlying(0, 1, String(1e16), 0, MAX_UINT256),
      ).to.be.reverted
    })

    it("Reverts with 'Token index out of range'", async () => {
      await expect(
        metaSwap.calculateSwapUnderlying(0, 9, String(1e17)),
      ).to.be.revertedWith("Token index out of range")

      await expect(
        metaSwap.swapUnderlying(0, 9, String(1e17), 0, MAX_UINT256),
      ).to.be.revertedWith("Token index out of range")
    })

    describe("Succeeds with expected swap amounts", () => {
      it("From 18 decimal token (meta) to 18 decimal token (base)", async () => {
        // User 1 calculates how much token to receive
        const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
          0,
          1,
          String(1e17),
        )
        expect(calculatedSwapReturn).to.eq(BigNumber.from("99682616104034773"))

        const [tokenFromBalanceBefore, tokenToBalanceBefore] =
          await getUserTokenBalances(user1, [frax, dai])

        // User 1 successfully initiates swap
        snapshotGasCost(
          await metaSwap
            .connect(user1)
            .swapUnderlying(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256)
        )

        // Check the sent and received amounts are as expected
        const [tokenFromBalanceAfter, tokenToBalanceAfter] =
          await getUserTokenBalances(user1, [frax, dai])
        expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
          BigNumber.from(String(1e17)),
        )
        expect(tokenToBalanceAfter.sub(tokenToBalanceBefore)).to.eq(
          calculatedSwapReturn,
        )
      })

      it("From 6 decimal token (base) to 18 decimal token (meta)", async () => {
        // User 1 calculates how much token to receive
        const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
          2,
          0,
          String(1e5),
        )
        // this estimation works way better, doesn't it?
        expect(calculatedSwapReturn).to.eq(BigNumber.from("99682656211218516"))

        // Calculating swapping from a base token to a meta level token
        // could be wrong by about half of the base pool swap fee, i.e. 0.02% in this example
        const minReturnWithNegativeSlippage = calculatedSwapReturn
          .mul(9998)
          .div(10000)

        const [tokenFromBalanceBefore, tokenToBalanceBefore] =
          await getUserTokenBalances(user1, [usdc, frax])

        // User 1 successfully initiates swap
        await metaSwap
          .connect(user1)
          .swapUnderlying(
            2,
            0,
            String(1e5),
            minReturnWithNegativeSlippage,
            MAX_UINT256,
          )

        // Check the sent and received amounts are as expected
        const [tokenFromBalanceAfter, tokenToBalanceAfter] =
          await getUserTokenBalances(user1, [usdc, frax])
        expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
          BigNumber.from(String(1e5)),
        )
        expect(tokenToBalanceAfter.sub(tokenToBalanceBefore)).to.eq(
          "99683651227847339",
        )
      })

      it("From 18 decimal token (meta) to 6 decimal token (base)", async () => {
        // User 1 calculates how much token to receive
        const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
          0,
          2,
          String(1e17),
        )
        expect(calculatedSwapReturn).to.eq(BigNumber.from("99682"))

        const [tokenFromBalanceBefore, tokenToBalanceBefore] =
          await getUserTokenBalances(user1, [frax, usdc])

        // User 1 successfully initiates swap
        await metaSwap
          .connect(user1)
          .swapUnderlying(0, 2, String(1e17), calculatedSwapReturn, MAX_UINT256)

        // Check the sent and received amounts are as expected
        const [tokenFromBalanceAfter, tokenToBalanceAfter] =
          await getUserTokenBalances(user1, [frax, usdc])
        expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
          BigNumber.from(String(1e17)),
        )
        expect(tokenToBalanceAfter.sub(tokenToBalanceBefore)).to.eq(
          calculatedSwapReturn,
        )
      })
    })

    it("Reverts when minDy (minimum amount token to receive) is not reached due to front running", async () => {
      // User 1 calculates how much token to receive
      const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
        0,
        1,
        String(1e17),
      )
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99682616104034773"))

      // User 2 swaps before User 1 does
      await metaSwap
        .connect(user2)
        .swapUnderlying(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 initiates swap
      await expect(
        metaSwap
          .connect(user1)
          .swapUnderlying(
            0,
            1,
            String(1e17),
            calculatedSwapReturn,
            MAX_UINT256,
          ),
      ).to.be.reverted
    })

    it("Succeeds when using lower minDy even when transaction is front-ran", async () => {
      // User 1 calculates how much token to receive with 1% slippage
      const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
        0,
        1,
        String(1e17),
      )
      expect(calculatedSwapReturn).to.eq(BigNumber.from("99682616104034773"))

      const [tokenFromBalanceBefore, tokenToBalanceBefore] =
        await getUserTokenBalances(user1, [frax, dai])

      const calculatedSwapReturnWithNegativeSlippage = calculatedSwapReturn
        .mul(99)
        .div(100)

      // User 2 swaps before User 1 does
      await metaSwap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)

      // User 1 successfully initiates swap with 1% slippage from initial calculated amount
      await metaSwap
        .connect(user1)
        .swapUnderlying(
          0,
          1,
          String(1e17),
          calculatedSwapReturnWithNegativeSlippage,
          MAX_UINT256,
        )

      // Check the sent and received amounts are as expected
      const [tokenFromBalanceAfter, tokenToBalanceAfter] =
        await getUserTokenBalances(user1, [frax, dai])

      expect(tokenFromBalanceBefore.sub(tokenFromBalanceAfter)).to.eq(
        BigNumber.from(String(1e17)),
      )

      const actualReceivedAmount = tokenToBalanceAfter.sub(tokenToBalanceBefore)

      expect(actualReceivedAmount).to.eq(BigNumber.from("99266340636749675"))
      expect(actualReceivedAmount).to.gt(
        calculatedSwapReturnWithNegativeSlippage,
      )
      expect(actualReceivedAmount).to.lt(calculatedSwapReturn)
    })

    it("Returns correct amount of received token", async () => {
      const swapReturnAmount = await metaSwap.callStatic.swapUnderlying(
        0,
        1,
        String(1e17),
        0,
        MAX_UINT256,
      )
      expect(swapReturnAmount).to.eq("99682616104034773")
    })

    it("Reverts when block is mined after deadline", async () => {
      const currentTimestamp = await getCurrentBlockTimestamp(provider)
      await setNextTimestamp(provider, currentTimestamp + 60 * 10)

      // User 1 tries swapping with deadline of +5 minutes
      await expect(
        metaSwap
          .connect(user1)
          .swapUnderlying(0, 1, String(1e17), 0, currentTimestamp + 60 * 5),
      ).to.be.revertedWith("timeout")
    })

    it("Emits TokenSwap event", async () => {
      // User 1 initiates swap
      await expect(
        metaSwap
          .connect(user1)
          .swapUnderlying(0, 1, String(1e17), 0, MAX_UINT256),
      ).to.emit(metaSwap, "TokenSwapUnderlying")
    })
  })

  describe("getVirtualPrice", () => {
    it("Returns expected value after initial deposit", async () => {
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from(String(1e18)),
      )
    })

    it("Returns expected values after swaps", async () => {
      // With each swap, virtual price will increase due to the fees
      await metaSwap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000050005862349911"),
      )

      await metaSwap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000100104768517937"),
      )
    })

    it("Returns expected values after imbalanced withdrawal", async () => {
      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      await metaSwap
        .connect(user2)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from(String(1e18)),
      )

      await metaLPToken.connect(user1).approve(metaSwap.address, String(2e18))
      await metaSwap
        .connect(user1)
        .removeLiquidityImbalance([String(1e18), 0], String(2e18), MAX_UINT256)

      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000100094088440633"),
      )

      await metaLPToken.connect(user2).approve(metaSwap.address, String(2e18))
      await metaSwap
        .connect(user2)
        .removeLiquidityImbalance([0, String(1e18)], String(2e18), MAX_UINT256)

      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000200154928939884"),
      )
    })

    it("Value is unchanged after balanced deposits", async () => {
      // pool is 1:1 ratio
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from(String(1e18)),
      )
      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from(String(1e18)),
      )

      // pool changes to 2:1 ratio, thus changing the virtual price
      await metaSwap
        .connect(user2)
        .addLiquidity([String(2e18), String(0)], 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000167146429977312"),
      )
      // User 2 makes balanced deposit, keeping the ratio 2:1
      await metaSwap
        .connect(user2)
        .addLiquidity([String(2e18), String(1e18)], 0, MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from("1000167146429977312"),
      )
    })

    it("Value is unchanged after balanced withdrawals", async () => {
      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
      await metaLPToken.connect(user1).approve(metaSwap.address, String(1e18))
      await metaSwap
        .connect(user1)
        .removeLiquidity(String(1e18), ["0", "0"], MAX_UINT256)
      expect(await metaSwap.getVirtualPrice()).to.eq(
        BigNumber.from(String(1e18)),
      )
    })
  })

  describe("setSwapFee", () => {
    it("Emits NewSwapFee event", async () => {
      await expect(metaSwap.setFee(BigNumber.from(1e8), 0)).to.emit(
        metaSwap,
        "NewFee",
      )
    })

    it("Reverts when called by non-owners", async () => {
      await expect(metaSwap.connect(user1).setFee(0, 0)).to.be.reverted
      await expect(metaSwap.connect(user2).setFee(BigNumber.from(1e8), 0)).to.be
        .reverted
    })

    it("Reverts when fee is higher than the limit", async () => {
      await expect(metaSwap.setFee(BigNumber.from(1e8).add(1), 0)).to.be.reverted
    })

    it("Succeeds when fee is within the limit", async () => {
      await metaSwap.setFee(BigNumber.from(1e8), 0)
      expect((await metaSwap.swapStorage()).fee).to.eq(BigNumber.from(1e8))
    })
  })

  describe("setAdminFee", () => {
    it("Emits NewAdminFee event", async () => {
      await expect(metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))).to.emit(
        metaSwap,
        "NewFee",
      )
    })

    it("Reverts when called by non-owners", async () => {
      await expect(metaSwap.connect(user1).setFee(BigNumber.from(SWAP_FEE), 0)).to.be.reverted
      await expect(metaSwap.connect(user2).setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))).to.be
        .reverted
    })

    it("Reverts when adminFee is higher than the limit", async () => {
      await expect(metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10).add(1))).to.be.reverted
    })

    it("Succeeds when adminFee is within the limit", async () => {
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(1e10))
      expect((await metaSwap.swapStorage()).adminFee).to.eq(BigNumber.from(1e10))
    })
  })

  describe("getAdminBalance", () => {
    it("Reverts with 'Token index out of range'", async () => {
      await expect(metaSwap.getAdminBalance(3)).to.be.revertedWith(
        "indexOutOfRange",
      )
    })

    it("Is always 0 when adminFee is set to 0", async () => {
      expect(await metaSwap.getAdminBalance(0)).to.eq(0)
      expect(await metaSwap.getAdminBalance(1)).to.eq(0)

      await metaSwap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)

      expect(await metaSwap.getAdminBalance(0)).to.eq(0)
      expect(await metaSwap.getAdminBalance(1)).to.eq(0)
    })

    it("Returns expected amounts after swaps when adminFee is higher than 0", async () => {
      // Sets adminFee to 1% of the swap fees
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await metaSwap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)

      expect(await metaSwap.getAdminBalance(0)).to.eq(0)
      expect(await metaSwap.getAdminBalance(1)).to.eq(String(998024139765))

      // After the first swap, the pool becomes imbalanced; there are more 0th token than 1st token in the pool.
      // Therefore swapping from 1st -> 0th will result in more 0th token returned
      // Also results in higher fees collected on the second swap.

      await metaSwap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)

      expect(await metaSwap.getAdminBalance(0)).to.eq(String(1001973776101))
      expect(await metaSwap.getAdminBalance(1)).to.eq(String(998024139765))
    })
  })

  describe("withdrawAdminFees", () => {
    it("Reverts when called by non-owners", async () => {
      await expect(metaSwap.connect(user1).withdrawAdminFee()).to.be.reverted
      await expect(metaSwap.connect(user2).withdrawAdminFee()).to.be.reverted
    })

    it("Succeeds when there are no fees withdrawn", async () => {
      // Sets adminFee to 1% of the swap fees
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      await metaSwap.withdrawAdminFee()

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      expect(firstTokenBefore).to.eq(firstTokenAfter)
      expect(secondTokenBefore).to.eq(secondTokenAfter)
    })

    it("Succeeds with expected amount of fees withdrawn (swap)", async () => {
      // Sets adminFee to 1% of the swap fees
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await metaSwap.connect(user1).swap(0, 1, String(1e17), 0, MAX_UINT256)
      await metaSwap.connect(user1).swap(1, 0, String(1e17), 0, MAX_UINT256)

      expect(await metaSwap.getAdminBalance(0)).to.eq(String(1001973776101))
      expect(await metaSwap.getAdminBalance(1)).to.eq(String(998024139765))

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      await metaSwap.withdrawAdminFee()

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      expect(firstTokenAfter.sub(firstTokenBefore)).to.eq(String(1001973776101))
      expect(secondTokenAfter.sub(secondTokenBefore)).to.eq(
        String(998024139765),
      )
    })

    it("Succeeds with expected amount of fees withdrawn (swapUnderlying)", async () => {
      // Sets adminFee to 1% of the swap fees
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await metaSwap
        .connect(user1)
        .swapUnderlying(0, 1, String(1e17), 0, MAX_UINT256)
      await metaSwap
        .connect(user1)
        .swapUnderlying(1, 0, String(1e17), 0, MAX_UINT256)

      expect(await metaSwap.getAdminBalance(0)).to.eq(String(1001774294135))
      expect(await metaSwap.getAdminBalance(1)).to.eq(String(998024139765))

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      await metaSwap.withdrawAdminFee()

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        owner,
        [frax, baseLPToken],
      )

      expect(firstTokenAfter.sub(firstTokenBefore)).to.eq(String(1001774294135))
      expect(secondTokenAfter.sub(secondTokenBefore)).to.eq(
        String(998024139765),
      )
    })

    it("Withdrawing admin fees has no impact on users' withdrawal", async () => {
      // Sets adminFee to 1% of the swap fees
      await metaSwap.setFee(BigNumber.from(SWAP_FEE), BigNumber.from(10 ** 8))
      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)

      for (let i = 0; i < 10; i++) {
        await metaSwap.connect(user2).swap(0, 1, String(1e17), 0, MAX_UINT256)
        await metaSwap.connect(user2).swap(1, 0, String(1e17), 0, MAX_UINT256)
      }

      await metaSwap.withdrawAdminFee()

      const [firstTokenBefore, secondTokenBefore] = await getUserTokenBalances(
        user1,
        [frax, baseLPToken],
      )

      const user1LPTokenBalance = await metaLPToken.balanceOf(user1Address)
      await metaLPToken
        .connect(user1)
        .approve(metaSwap.address, user1LPTokenBalance)
      await metaSwap
        .connect(user1)
        .removeLiquidity(user1LPTokenBalance, [0, 0], MAX_UINT256)

      const [firstTokenAfter, secondTokenAfter] = await getUserTokenBalances(
        user1,
        [frax, baseLPToken],
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
        metaSwap.rampA(
          100,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        ),
      ).to.emit(metaSwap, "RampA")
    })

    it("Succeeds to ramp upwards", async () => {
      // Create imbalanced pool to measure virtual price change
      // We expect virtual price to increase as A decreases
      await metaSwap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // call rampA(), changing A to 100 within a span of 14 days
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1
      await metaSwap.rampA(100, endTimestamp)

      // +0 seconds since ramp A
      expect(await metaSwap.getA()).to.be.eq(50)
      expect(await metaSwap.getAPrecise()).to.be.eq(5000)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000258443200231295")

      // set timestamp to the end of ramp period
      await setTimestamp(provider, endTimestamp)
      expect(await metaSwap.getA()).to.be.eq(100)
      expect(await metaSwap.getAPrecise()).to.be.eq(10000)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000771363829405068")
    })

    it("Succeeds to ramp downwards", async () => {
      // Create imbalanced pool to measure virtual price change
      // We expect virtual price to decrease as A decreases
      await metaSwap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1
      await metaSwap.rampA(25, endTimestamp)

      // +0 seconds since ramp A
      expect(await metaSwap.getA()).to.be.eq(50)
      expect(await metaSwap.getAPrecise()).to.be.eq(5000)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await metaSwap.getA()).to.be.eq(47)
      expect(await metaSwap.getAPrecise()).to.be.eq(4794)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000115870150391894")

      // set timestamp to the end of ramp period
      await setTimestamp(provider, endTimestamp)
      expect(await metaSwap.getA()).to.be.eq(25)
      expect(await metaSwap.getAPrecise()).to.be.eq(2500)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("998999574522335473")
    })

    it("Reverts when non-owner calls it", async () => {
      await expect(
        metaSwap
          .connect(user1)
          .rampA(55, (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1),
      ).to.be.reverted
    })

    it("Reverts with 'Wait 1 day before starting ramp'", async () => {
      await metaSwap.rampA(
        55,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )
      await expect(
        metaSwap.rampA(
          55,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        ),
      ).to.be.revertedWith("< rampDelay")
    })

    it("Reverts with 'Insufficient ramp time'", async () => {
      await expect(
        metaSwap.rampA(
          55,
          (await getCurrentBlockTimestamp(provider)) + 1 * TIME.DAYS - 1,
        ),
      ).to.be.revertedWith("< minRampTime")
    })

    it("Reverts with 'futureA_ must be > 0 and < MAX_A'", async () => {
      await expect(
        metaSwap.rampA(
          0,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        ),
      ).to.be.revertedWith("outOfRange")
    })
  })

  describe("stopRampA", () => {
    it("Emits StopRampA event", async () => {
      // call rampA()
      await metaSwap.rampA(
        100,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100,
      )

      // Stop ramp
      expect(await metaSwap.stopRampA()).to.emit(metaSwap, "StopRampA")
    })

    it("Stop ramp succeeds", async () => {
      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100
      await metaSwap.rampA(100, endTimestamp)

      // set timestamp to +100000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)

      // Stop ramp
      await metaSwap.stopRampA()
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)

      // set timestamp to endTimestamp
      await setTimestamp(provider, endTimestamp)

      // verify ramp has stopped
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)
    })

    it("Reverts with 'Ramp is already stopped'", async () => {
      // call rampA()
      const endTimestamp =
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 100
      await metaSwap.rampA(100, endTimestamp)

      // set timestamp to +10000 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 100000)
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)

      // Stop ramp
      await metaSwap.stopRampA()
      expect(await metaSwap.getA()).to.be.eq(54)
      expect(await metaSwap.getAPrecise()).to.be.eq(5413)

      // check call reverts when ramp is already stopped
      await expect(metaSwap.stopRampA()).to.be.revertedWith(
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
      // Sets the pool in 2:1 ratio where frax is significantly cheaper than lpToken
      await metaSwap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // Initial A and virtual price
      expect(await metaSwap.getA()).to.be.eq(50)
      expect(await metaSwap.getAPrecise()).to.be.eq(5000)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // Start ramp
      await metaSwap.rampA(
        100,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )

      // Malicious miner skips 900 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

      expect(await metaSwap.getA()).to.be.eq(50)
      expect(await metaSwap.getAPrecise()).to.be.eq(5003)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000167862696363286")

      // Max increase of A between two blocks
      // 5003 / 5000
      // = 1.0006

      // Max increase of virtual price between two blocks (at 2:1 ratio of tokens, starting A = 50)
      // 1000167862696363286 / 1000167146429977312
      // = 1.00000071615
    })

    it("Check for maximum differences in A and virtual price when A is decreasing", async () => {
      // Create imbalanced pool to measure virtual price change
      // Sets the pool in 2:1 ratio where frax is significantly cheaper than lpToken
      await metaSwap.addLiquidity([String(1e18), 0], 0, MAX_UINT256)

      // Initial A and virtual price
      expect(await metaSwap.getA()).to.be.eq(50)
      expect(await metaSwap.getAPrecise()).to.be.eq(5000)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000167146429977312")

      // Start ramp
      await metaSwap.rampA(
        25,
        (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
      )

      // Malicious miner skips 900 seconds
      await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

      expect(await metaSwap.getA()).to.be.eq(49)
      expect(await metaSwap.getAPrecise()).to.be.eq(4999)
      expect(await metaSwap.getVirtualPrice()).to.be.eq("1000166907487883089")

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
          frax,
          baseLPToken,
        ])

        expect(initialAttackerBalances[0]).to.be.eq("100000000000000000000000")
        expect(initialAttackerBalances[1]).to.be.eq(String(3e20))

        // Start ramp upwards
        await metaSwap.rampA(
          100,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        )
        expect(await metaSwap.getAPrecise()).to.be.eq(5000)

        // Check current pool balances
        initialPoolBalances = [
          await metaSwap.getTokenBalance(0),
          await metaSwap.getTokenBalance(1),
        ]
        expect(initialPoolBalances[0]).to.be.eq(String(1e18))
        expect(initialPoolBalances[1]).to.be.eq(String(1e18))
      })

      describe(
        "When tokens are priced equally: " +
          "attacker creates massive imbalance prior to A change, and resolves it after",
        () => {
          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of frax to lpToken, causing massive imbalance in the pool
            await metaSwap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, baseLPToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 9.085e17 of lpToken
            expect(secondTokenOutput).to.be.eq("908591742545002306")

            // Pool is imbalanced! Now trades from lpToken -> frax may be profitable in small sizes
            // frax balance in the pool  : 2.00e18
            // lpToken balance in the pool : 9.14e16
            expect(await metaSwap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await metaSwap.getTokenBalance(1)).to.be.eq(
              "91408257454997694",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed upwards
            // 5000 -> 5003 (0.06%)
            expect(await metaSwap.getAPrecise()).to.be.eq(5003)

            // Trade lpToken to frax, taking advantage of the imbalance and change of A
            const balanceBefore = await getUserTokenBalance(attacker, frax)
            await metaSwap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, frax)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more frax than the start.
            expect(firstTokenOutput).to.be.eq("997214696574405737")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              frax,
              baseLPToken,
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
            // Attacker lost 2.785e15 frax (0.2785% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = []
            finalPoolBalances.push(await metaSwap.getTokenBalance(0))
            finalPoolBalances.push(await metaSwap.getTokenBalance(1))

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "2785303425594263",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 2.785e15 frax (0.2785% of frax balance)
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
            await metaSwap
              .connect(user2)
              .addLiquidity(
                [String(0), String(2e18)],
                0,
                (await getCurrentBlockTimestamp(provider)) + 60,
              )

            // Check current pool balances
            initialPoolBalances = [
              await metaSwap.getTokenBalance(0),
              await metaSwap.getTokenBalance(1),
            ]
            expect(initialPoolBalances[0]).to.be.eq(String(1e18))
            expect(initialPoolBalances[1]).to.be.eq(String(3e18))
          })

          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of frax to lpToken, resolving imbalance in the pool
            await metaSwap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, baseLPToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 1.012e18 of lpToken
            // Because the pool was imbalanced in the beginning, this trade results in more than 1e18 lpToken
            expect(secondTokenOutput).to.be.eq("1011933251060681353")

            // Pool is now almost balanced!
            // frax balance in the pool  : 2.000e18
            // lpToken balance in the pool : 1.988e18
            expect(await metaSwap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await metaSwap.getTokenBalance(1)).to.be.eq(
              "1988066748939318647",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed upwards
            // 5000 -> 5003 (0.06%)
            expect(await metaSwap.getAPrecise()).to.be.eq(5003)

            // Trade lpToken to frax, taking advantage of the imbalance and sudden change of A
            const balanceBefore = await getUserTokenBalance(attacker, frax)
            await metaSwap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, frax)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the attacker leaves with more frax than the start.
            expect(firstTokenOutput).to.be.eq("998017518949630644")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              frax,
              baseLPToken,
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
            // Attacker lost 1.982e15 frax (0.1982% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = []
            finalPoolBalances.push(await metaSwap.getTokenBalance(0))
            finalPoolBalances.push(await metaSwap.getTokenBalance(1))

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "1982481050369356",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 1.982e15 frax (0.1982% of frax balance)
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
          frax,
          baseLPToken,
        ])

        expect(initialAttackerBalances[0]).to.be.eq("100000000000000000000000")
        expect(initialAttackerBalances[1]).to.be.eq(String(3e20))

        // Start ramp downwards
        await metaSwap.rampA(
          25,
          (await getCurrentBlockTimestamp(provider)) + 14 * TIME.DAYS + 1,
        )
        expect(await metaSwap.getAPrecise()).to.be.eq(5000)

        // Check current pool balances
        initialPoolBalances = [
          await metaSwap.getTokenBalance(0),
          await metaSwap.getTokenBalance(1),
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
            // Swap 1e18 of frax to lpToken, causing massive imbalance in the pool
            await metaSwap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, baseLPToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 9.085e17 of lpToken
            expect(secondTokenOutput).to.be.eq("908591742545002306")

            // Pool is imbalanced! Now trades from lpToken -> frax may be profitable in small sizes
            // frax balance in the pool  : 2.00e18
            // lpToken balance in the pool : 9.14e16
            expect(await metaSwap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await metaSwap.getTokenBalance(1)).to.be.eq(
              "91408257454997694",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed downwards
            expect(await metaSwap.getAPrecise()).to.be.eq(4999)

            const balanceBefore = await getUserTokenBalance(attacker, frax)
            await metaSwap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, frax)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more frax than the start.
            expect(firstTokenOutput).to.be.eq("997276754500361021")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              frax,
              baseLPToken,
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
            // Attacker lost 2.723e15 frax (0.2723% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = [
              await metaSwap.getTokenBalance(0),
              await metaSwap.getTokenBalance(1),
            ]

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "2723245499638979",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 2.723e15 frax (0.2723% of frax balance)
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
            await metaSwap
              .connect(user2)
              .addLiquidity(
                [String(0), String(2e18)],
                0,
                (await getCurrentBlockTimestamp(provider)) + 60,
              )

            // Check current pool balances
            initialPoolBalances = [
              await metaSwap.getTokenBalance(0),
              await metaSwap.getTokenBalance(1),
            ]
            expect(initialPoolBalances[0]).to.be.eq(String(1e18))
            expect(initialPoolBalances[1]).to.be.eq(String(3e18))
          })

          it("Attack fails with 900 seconds between blocks", async () => {
            // Swap 1e18 of frax to lpToken, resolving imbalance in the pool
            await metaSwap
              .connect(attacker)
              .swap(0, 1, String(1e18), 0, MAX_UINT256)
            const secondTokenOutput = (
              await getUserTokenBalance(attacker, baseLPToken)
            ).sub(initialAttackerBalances[1])

            // First trade results in 1.012e18 of lpToken
            // Because the pool was imbalanced in the beginning, this trade results in more than 1e18 lpToken
            expect(secondTokenOutput).to.be.eq("1011933251060681353")

            // Pool is now almost balanced!
            // frax balance in the pool  : 2.000e18
            // lpToken balance in the pool : 1.988e18
            expect(await metaSwap.getTokenBalance(0)).to.be.eq(String(2e18))
            expect(await metaSwap.getTokenBalance(1)).to.be.eq(
              "1988066748939318647",
            )

            // Malicious miner skips 900 seconds
            await setTimestamp(provider, (await getCurrentBlockTimestamp(provider)) + 900)

            // Verify A has changed downwards
            expect(await metaSwap.getAPrecise()).to.be.eq(4999)

            const balanceBefore = await getUserTokenBalance(attacker, frax)
            await metaSwap
              .connect(attacker)
              .swap(1, 0, secondTokenOutput, 0, MAX_UINT256)
            const firstTokenOutput = (
              await getUserTokenBalance(attacker, frax)
            ).sub(balanceBefore)

            // If firstTokenOutput > 1e18, the malicious user leaves with more frax than the start.
            expect(firstTokenOutput).to.be.eq("998007711333645455")

            const finalAttackerBalances = await getUserTokenBalances(attacker, [
              frax,
              baseLPToken,
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
            // Attacker lost 1.992e15 frax (0.1992% of initial deposit)

            // Check for pool balance changes
            const finalPoolBalances = [
              await metaSwap.getTokenBalance(0),
              await metaSwap.getTokenBalance(1),
            ]

            expect(finalPoolBalances[0]).to.be.gt(initialPoolBalances[0])
            expect(finalPoolBalances[1]).to.be.eq(initialPoolBalances[1])
            expect(finalPoolBalances[0].sub(initialPoolBalances[0])).to.be.eq(
              "1992288666354545",
            )
            expect(finalPoolBalances[1].sub(initialPoolBalances[1])).to.be.eq(
              "0",
            )
            // Pool (liquidity providers) gained 1.992e15 frax (0.1992% of frax balance)
            // The attack did not benefit the attacker.
          })
        },
      )
    })
  })
})
