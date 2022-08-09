import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { BigNumber, Contract, ContractFactory, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import TestERC20 from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import StableSwap from '../build/contracts/stableswap/StableSwap.sol/StableSwap.json'
import StableSwapStorage from '../build/contracts/stableswap/StableSwapStorage.sol/StableSwapStorage.json'
import MetaSwap from '../build/contracts/stableswap/MetaSwap.sol/MetaSwap.json'
import MetaSwapStorage from '../build/contracts/stableswap/MetaSwapStorage.sol/MetaSwapStorage.json'

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

chai.use(solidity)

const overrides = {
  gasLimit: 6100000
}

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
          MAX_UINT256,
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
    // await metaSwap.addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
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
      console.log((await frax.allowance(user1Address, metaSwap.address)).toString())
      console.log((await baseLPToken.allowance(user1Address, metaSwap.address)).toString())

      await metaSwap
        .connect(user1)
        .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

      const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)
      expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    })

    // it("Reverts with 'Amounts must match pooled tokens'", async () => {
    //   await expect(
    //     metaSwap.connect(user1).addLiquidity([String(1e16)], 0, MAX_UINT256),
    //   ).to.be.revertedWith("Amounts must match pooled tokens")
    // })

    // it("Reverts with 'Cannot withdraw more than available'", async () => {
    //   await expect(
    //     metaSwap
    //       .connect(user1)
    //       .calculateTokenAmount([MAX_UINT256, String(3e18)], false),
    //   ).to.be.revertedWith("Cannot withdraw more than available")
    // })

    // it("Reverts with 'Must supply all tokens in pool'", async () => {
    //   metaLPToken.approve(metaSwap.address, String(2e18))
    //   await metaSwap.removeLiquidity(String(2e18), [0, 0], MAX_UINT256)
    //   await expect(
    //     metaSwap
    //       .connect(user1)
    //       .addLiquidity([0, String(3e18)], MAX_UINT256, MAX_UINT256),
    //   ).to.be.revertedWith("Must supply all tokens in pool")
    // })

    // it("Succeeds with expected output amount of pool tokens", async () => {
    //   const calculatedPoolTokenAmount = await metaSwap
    //     .connect(user1)
    //     .calculateTokenAmount([String(1e18), String(3e18)], true)

    //   const calculatedPoolTokenAmountWithSlippage = calculatedPoolTokenAmount
    //     .mul(999)
    //     .div(1000)

    //   await metaSwap
    //     .connect(user1)
    //     .addLiquidity(
    //       [String(1e18), String(3e18)],
    //       calculatedPoolTokenAmountWithSlippage,
    //       MAX_UINT256,
    //     )

    //   const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

    //   // The actual pool token amount is less than 4e18 due to the imbalance of the underlying tokens
    //   expect(actualPoolTokenAmount).to.eq(BigNumber.from("3991672211258372957"))
    // })

    // it("Succeeds with actual pool token amount being within ±0.1% range of calculated pool token", async () => {
    //   const calculatedPoolTokenAmount = await metaSwap
    //     .connect(user1)
    //     .calculateTokenAmount([String(1e18), String(3e18)], true)

    //   const calculatedPoolTokenAmountWithNegativeSlippage =
    //     calculatedPoolTokenAmount.mul(999).div(1000)

    //   const calculatedPoolTokenAmountWithPositiveSlippage =
    //     calculatedPoolTokenAmount.mul(1001).div(1000)

    //   await metaSwap
    //     .connect(user1)
    //     .addLiquidity(
    //       [String(1e18), String(3e18)],
    //       calculatedPoolTokenAmountWithNegativeSlippage,
    //       MAX_UINT256,
    //     )

    //   const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

    //   expect(actualPoolTokenAmount).to.gte(
    //     calculatedPoolTokenAmountWithNegativeSlippage,
    //   )

    //   expect(actualPoolTokenAmount).to.lte(
    //     calculatedPoolTokenAmountWithPositiveSlippage,
    //   )
    // })

    // it("Succeeds with correctly updated tokenBalance after imbalanced deposit", async () => {
    //   await metaSwap
    //     .connect(user1)
    //     .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

    //   // Check updated token balance
    //   expect(await metaSwap.getTokenBalance(0)).to.eq(
    //     BigNumber.from(String(2e18)),
    //   )
    //   expect(await metaSwap.getTokenBalance(1)).to.eq(
    //     BigNumber.from(String(4e18)),
    //   )
    // })

    // it("Returns correct minted lpToken amount", async () => {
    //   const mintedAmount = await metaSwap
    //     .connect(user1)
    //     .callStatic.addLiquidity([String(1e18), String(2e18)], 0, MAX_UINT256)

    //   expect(mintedAmount).to.eq("2997459774673651937")
    // })

    // it("Reverts when minToMint is not reached due to front running", async () => {
    //   const calculatedLPTokenAmount = await metaSwap
    //     .connect(user1)
    //     .calculateTokenAmount([String(1e18), String(3e18)], true)

    //   const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
    //     .mul(999)
    //     .div(1000)

    //   // Someone else deposits thus front running user 1's deposit
    //   await metaSwap.addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

    //   await expect(
    //     metaSwap
    //       .connect(user1)
    //       .addLiquidity(
    //         [String(1e18), String(3e18)],
    //         calculatedLPTokenAmountWithSlippage,
    //         MAX_UINT256,
    //       ),
    //   ).to.be.reverted
    // })

    // it("Reverts when block is mined after deadline", async () => {
    //   const currentTimestamp = await getCurrentBlockTimestamp(provider)
    //   await setNextTimestamp(provider, currentTimestamp + 60 * 10)

    //   await expect(
    //     metaSwap
    //       .connect(user1)
    //       .addLiquidity(
    //         [String(2e18), String(1e16)],
    //         0,
    //         currentTimestamp + 60 * 5,
    //       ),
    //   ).to.be.revertedWith("Deadline not met")
    // })

    // it("Emits addLiquidity event", async () => {
    //   const calculatedLPTokenAmount = await metaSwap
    //     .connect(user1)
    //     .calculateTokenAmount([String(2e18), String(1e16)], true)

    //   const calculatedLPTokenAmountWithSlippage = calculatedLPTokenAmount
    //     .mul(999)
    //     .div(1000)

    //   await expect(
    //     metaSwap
    //       .connect(user1)
    //       .addLiquidity(
    //         [String(2e18), String(1e16)],
    //         calculatedLPTokenAmountWithSlippage,
    //         MAX_UINT256,
    //       ),
    //   ).to.emit(metaSwap.connect(user1), "AddLiquidity")
    // })
  })
})
