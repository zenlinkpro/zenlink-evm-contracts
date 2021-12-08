import { expect, use } from 'chai';
import { deployContract, MockProvider } from 'ethereum-waffle';
import { BigNumber, constants, Contract } from 'ethers';
import { waffle } from 'hardhat';
import { BootstrapFixture } from './shared/fixtures';
import { createTimeMachine } from './shared/time';
import { expandTo10Decimals, expandTo18Decimals } from './shared/utilities';

import BasicToken from '../build/contracts/test/BasicToken.sol/BasicToken.json'
import Pair from '../build/contracts/core/Pair.sol/Pair.json'

use(waffle.solidity);

async function advanceEndBlock(
    provider: MockProvider,
    blocks: number,
): Promise<number> {
    const currentBlock = (await provider.getBlock('latest')).number

    return currentBlock + blocks
}

function getSortedAddress(token0: string, token1: string): [string, string] {
    return token0 < token1 ? [token0, token1] : [token1, token0]
}

const overrides = { gasLimit: 4100000 }

let endBlock = 100

describe('Bootstrap', () => {
    const provider: MockProvider = waffle.provider
    const Time = createTimeMachine(provider)
    const [wallet, walletTo] = provider.getWallets()

    let token0: Contract
    let token1: Contract
    let bootstrap: Contract
    let factory: Contract

    let limit0Token: Contract
    let limit1Token: Contract
    let reward0Token: Contract
    let reward1Token: Contract

    beforeEach(async () => {
        endBlock = await advanceEndBlock(provider, 100)
        const fixture = await BootstrapFixture(wallet, endBlock)
        token0 = fixture.token0
        token1 = fixture.token1
        bootstrap = fixture.bootstrap
        factory = fixture.factory

        await token0.transfer(walletTo.address, expandTo18Decimals(50000), overrides)
        await token1.transfer(walletTo.address, expandTo18Decimals(50000), overrides)
        await token0.approve(bootstrap.address, constants.MaxUint256, overrides)
        await token1.approve(bootstrap.address, constants.MaxUint256, overrides)
        await token0.connect(walletTo).approve(bootstrap.address, constants.MaxUint256, overrides)
        await token1.connect(walletTo).approve(bootstrap.address, constants.MaxUint256, overrides)

        limit0Token = await deployContract(wallet, BasicToken, ["Limit Token 0", "LT0", expandTo10Decimals(500)], overrides)
        limit1Token = await deployContract(wallet, BasicToken, ["Limit Token 1", "LT1", expandTo10Decimals(500)], overrides)
        reward0Token = await deployContract(wallet, BasicToken, ["Reward Token 0", "RT0", expandTo10Decimals(500)], overrides)
        reward1Token = await deployContract(wallet, BasicToken, ["Reward Token 1", "RT1", expandTo10Decimals(500)], overrides)
    })

    it('set paramaters', async () => {
        await bootstrap.setMinumAmount0(BigNumber.from('10000'))
        await bootstrap.setMinumAmount1(BigNumber.from('20000'))
        const currentMinumAmount0 = await bootstrap.MINUM_AMOUNT0()
        const currentMinumAmount1 = await bootstrap.MINUM_AMOUNT1()

        await bootstrap.setHardCapAmount0(BigNumber.from('20000'))
        await bootstrap.setHardCapAmount1(BigNumber.from('40000'))
        const currentCapAmount0 = await bootstrap.HARD_CAP_AMOUNT0()
        const currentCapAmount1 = await bootstrap.HARD_CAP_AMOUNT1()

        const expectEndBlock = (await provider.getBlock('latest')).number + 200
        await bootstrap.setEndBlock(expectEndBlock)
        const newEndBlock = await bootstrap.END_BLOCK()
        expect(currentMinumAmount0).to.equal(BigNumber.from('10000'))
        expect(currentMinumAmount1).to.equal(BigNumber.from('20000'))
        expect(currentCapAmount0).to.equal(BigNumber.from('20000'))
        expect(currentCapAmount1).to.equal(BigNumber.from('40000'))
        expect(newEndBlock).to.equal(expectEndBlock)
    })

    it('set paramaters: fail', async () => {
        await expect(bootstrap.setEndBlock(BigNumber.from('1')))
            .to.be.revertedWith('INVALID_END_BLOCK')
        await expect(bootstrap.setHardCapAmount0(BigNumber.from('5000')))
            .to.be.revertedWith('INVALID_AMOUNT0')
        await expect(bootstrap.setHardCapAmount1(BigNumber.from('5000')))
            .to.be.revertedWith('INVALID_AMOUNT1')
    })

    it('addProvision', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const expectedAmount0 = BigNumber.from(100)
        const expectedAmount1 = BigNumber.from(200)
        await bootstrap.addProvision(address0, address1, expectedAmount0, expectedAmount1)
        await bootstrap
            .connect(walletTo)
            .addProvision(address1, address0, expectedAmount1, expectedAmount0)
        const totalAmount0 = await bootstrap.totalAmount0()
        const totalAmount1 = await bootstrap.totalAmount1()
        const walletInfo = await bootstrap.getUserInfo(wallet.address)
        const walletToInfo = await bootstrap.getUserInfo(walletTo.address)
        expect(totalAmount0).to.equal(expectedAmount0.mul(2))
        expect(totalAmount1).to.equal(expectedAmount1.mul(2))
        expect(walletInfo.amount0).to.equal(expectedAmount0)
        expect(walletToInfo.amount1).to.equal(expectedAmount1)
    })

    it('addProvision: fail', async () => {
        const otherToken = await deployContract(
            wallet,
            BasicToken,
            ["other Token", "OT", expandTo10Decimals(500)],
            overrides
        )
        const [_address0, _address1] = getSortedAddress(token0.address, otherToken.address)
        await expect(
            bootstrap.addProvision(
                _address0,
                _address1,
                '100',
                '100'
            )
        )
            .to.be.revertedWith('INVALID_TOKEN')

        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        await expect(
            bootstrap.addProvision(
                address0,
                address1,
                '0',
                '0'
            )
        )
            .to.be.revertedWith('INVALID_ZERO_AMOUNT')

        const currentBlock = (await provider.getBlock('latest')).number
        await bootstrap.setEndBlock(currentBlock + 2)
        await Time.advanceBlockTo(endBlock)
        await expect(
            bootstrap.addProvision(
                address0,
                address1,
                '10',
                '0'
            )
        )
            .to.be.revertedWith('BOOTSTRAP_ENDED')
    })

    it('addPosition: over hard cap', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const firstAddedAmount0 = BigNumber.from('14000')
        const firstAddedAmount1 = BigNumber.from('18000')
        await bootstrap.addProvision(address0, address1, firstAddedAmount0, firstAddedAmount1)

        const balance0AfterFirstAdded = await token0.balanceOf(wallet.address)
        const balance1AfterFirstAdded = await token1.balanceOf(wallet.address)
        await bootstrap.addProvision(address0, address1, '5000', '5000')
        const balance0AfterSecondAdded = await token0.balanceOf(wallet.address)
        const balance1AfterSecondAdded = await token1.balanceOf(wallet.address)

        expect(balance0AfterFirstAdded.sub(balance0AfterSecondAdded)).to.equal(BigNumber.from('1000'))
        expect(balance1AfterFirstAdded.sub(balance1AfterSecondAdded)).to.equal(BigNumber.from('2000'))

        await expect(
            bootstrap.addProvision(
                address0,
                address1,
                '1',
                '0'
            )
        ).to.be.revertedWith('AMOUNT0_CAPPED');
        await expect(
            bootstrap.addProvision(
                address0,
                address1,
                '0',
                '1'
            )
        ).to.be.revertedWith('AMOUNT1_CAPPED');
    })

    it('mintLiquidity', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        await bootstrap.addProvision(address0, address1, '5000', '5000')
        await bootstrap.connect(walletTo).addProvision(address0, address1, '6000', '6000')
        await Time.advanceBlockTo(endBlock)
        await expect(
            bootstrap.mintLiquidity(overrides)
        ).to.be.revertedWith('NOT_BOOTSTRAP_OWNER')

        await factory.setBootstrap(address0, address1, bootstrap.address)
        await bootstrap.mintLiquidity(overrides)
        const pairAddress = await factory.getPair(address0, address1)
        const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)
        // sqrt(11000 * 11000) - 1000
        expect(liquidtyBalance).to.equal(BigNumber.from('10000'))
    })

    it('mintLiquidity and claim: between soft cap and hard cap', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)

        await bootstrap.addProvision(address0, address1, '11000', '19000')
        await Time.advanceBlockTo(endBlock)
        await factory.setBootstrap(address0, address1, bootstrap.address)
        await bootstrap.mintLiquidity(overrides)

        const pairAddress = await factory.getPair(address0, address1)
        const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)

        // sqrt(11000 * 19000) - 1000
        expect(liquidtyBalance).to.equal(BigNumber.from('13456'))
        const expectLiquidity = await bootstrap.getExactLiquidity(wallet.address, overrides)

        await bootstrap.claim(overrides)

        const liquidityBalance = await pair.balanceOf(wallet.address)
        expect(expectLiquidity).to.equal(liquidityBalance.sub('1000'))
        const walletInfo = await bootstrap.getUserInfo(wallet.address)
        expect(walletInfo.amount0).to.equal(BigNumber.from('0'))
        expect(walletInfo.amount1).to.equal(BigNumber.from('0'))
    })

    it('mintLiquidity and claim: at hard cap', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)

        await bootstrap.addProvision(address0, address1, '16000', '22000')
        await Time.advanceBlockTo(endBlock)
        await factory.setBootstrap(address0, address1, bootstrap.address)
        await bootstrap.mintLiquidity(overrides)

        const pairAddress = await factory.getPair(address0, address1)
        const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)

        // sqrt(15000 * 20000) - 1000 (hard cap at 15000 and 20000)
        expect(liquidtyBalance).to.equal(BigNumber.from('16320'))
        const expectLiquidity = await bootstrap.getExactLiquidity(wallet.address, overrides)

        await bootstrap.claim(overrides)

        const liquidityBalance = await pair.balanceOf(wallet.address)
        expect(expectLiquidity).to.equal(liquidityBalance.sub('1000'))
        const walletInfo = await bootstrap.getUserInfo(wallet.address)
        expect(walletInfo.amount0).to.equal(BigNumber.from('0'))
        expect(walletInfo.amount1).to.equal(BigNumber.from('0'))
    })

    it('claim', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        await bootstrap.addProvision(address0, address1, '5000', '6000')
        await bootstrap.connect(walletTo).addProvision(address0, address1, '6000', '8000')
        await expect(
            bootstrap.claim(overrides)
        ).to.be.revertedWith('NOT_ENDED_AND_CAPPED')
        await Time.advanceBlockTo(endBlock)
        await expect(
            bootstrap.claim(overrides)
        ).to.be.revertedWith('PAIR_NOT_CREATED')

        await factory.setBootstrap(address0, address1, bootstrap.address)
        await bootstrap.mintLiquidity(overrides)
        const pairAddress = await factory.getPair(address0, address1)
        const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)
        const expectWalletLp = await bootstrap.getExactLiquidity(wallet.address, overrides)
        const expectWalletToLp = await bootstrap.getExactLiquidity(walletTo.address, overrides)
        await bootstrap.claim(overrides)
        await bootstrap.connect(walletTo).claim(overrides)
        const walletLpBalance = await pair.balanceOf(wallet.address)
        const walletToLpBalance = await pair.balanceOf(walletTo.address)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)
        // minumLiquidity minted to factory deployer
        expect(expectWalletLp).to.equal(walletLpBalance.sub('1000'))
        expect(expectWalletToLp).to.equal(walletToLpBalance)
        expect(liquidtyBalance).to.equal(BigNumber.from('2'))

        const walletInfo = await bootstrap.getUserInfo(wallet.address)
        expect(walletInfo.amount0).to.equal(BigNumber.from('0'))
        expect(walletInfo.amount1).to.equal(BigNumber.from('0'))
    })

    it('refund', async () => {
        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const prevBalanceOfWalletToken0 = await token0.balanceOf(wallet.address)
        const prevBalanceOfWalletToken1 = await token1.balanceOf(wallet.address)
        await bootstrap.addProvision(address0, address1, '5000', '6000')
        await bootstrap.connect(walletTo).addProvision(address0, address1, '3000', '1000')
        await Time.advanceBlockTo(endBlock)
        await expect(
            bootstrap.claim(overrides)
        ).to.be.revertedWith('NOT_ENDED_AND_CAPPED')
        await factory.setBootstrap(address0, address1, bootstrap.address)
        await expect(
            bootstrap.mintLiquidity(overrides)
        ).to.be.revertedWith('NOT_ENDED_AND_CAPPED')
        await bootstrap.refund(overrides)
        const afterBalanceOfWalletToken0 = await token0.balanceOf(wallet.address)
        const afterBalanceOfWalletToken1 = await token1.balanceOf(wallet.address)
        expect(prevBalanceOfWalletToken0).to.equal(afterBalanceOfWalletToken0)
        expect(prevBalanceOfWalletToken1).to.equal(afterBalanceOfWalletToken1)
        const totalAmount0 = await bootstrap.totalAmount0()
        const totalAmount1 = await bootstrap.totalAmount1()
        expect(totalAmount0).to.equal(BigNumber.from('3000'))
        expect(totalAmount1).to.equal(BigNumber.from('1000'))
    })

    it('withdrawExtraFunds', async () => {
        const otherToken = await deployContract(
            wallet,
            BasicToken,
            ["other Token", "OT", expandTo10Decimals(500)],
            overrides
        )
        const transferAmount = expandTo10Decimals(200)
        await otherToken.transfer(bootstrap.address, transferAmount, overrides)
        expect(await otherToken.balanceOf(bootstrap.address)).to.equal(transferAmount)
        expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(300))
        await bootstrap.withdrawExtraFunds(otherToken.address, wallet.address, expandTo10Decimals(100), overrides)
        expect(await otherToken.balanceOf(bootstrap.address)).to.equal(expandTo10Decimals(100))
        expect(await otherToken.balanceOf(wallet.address)).to.equal(expandTo10Decimals(400))
    })

    it('set limit and rewards', async () => {
        await expect(bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [expandTo10Decimals(100), expandTo10Decimals(200)]
        ))
            .to.emit(bootstrap, 'SetRewardAndLimit')
            .withArgs(
                [reward0Token.address, reward1Token.address],
                [limit0Token.address, limit1Token.address],
                [expandTo10Decimals(100), expandTo10Decimals(200)]
            )

        let rewards = await bootstrap.getRewardTokens()
        expect(rewards[0]).to.equal(reward0Token.address)
        expect(rewards[1]).to.equal(reward1Token.address)

        let limits = await bootstrap.getLimitTokens()
        expect(limits[0]).to.equal(limit0Token.address)
        expect(limits[1]).to.equal(limit1Token.address)

        let amounts = await bootstrap.getLimitAmounts()

        expect(amounts[0]).to.equal(expandTo10Decimals(100))
        expect(amounts[1]).to.equal(expandTo10Decimals(200))
    })

    it('charge with insufficient account should failed', async () => {
        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [expandTo10Decimals(100), expandTo10Decimals(200)]
        )
            
        await limit0Token.transfer(walletTo.address, expandTo10Decimals(500))
        await limit1Token.transfer(walletTo.address, expandTo10Decimals(500))

        await expect(bootstrap.charge(
            [expandTo10Decimals(100), expandTo10Decimals(200)]
        )).to.be.revertedWith('TransferHelper::transferFrom: transferFrom failed')

        let rewardAmounts = await bootstrap.getRewardTokenAmounts()

        let reward0Balance = await reward0Token.balanceOf(bootstrap.address)
        let reward1Balance = await reward1Token.balanceOf(bootstrap.address)
        expect(reward0Balance).to.equal(0)
        expect(reward1Balance).to.equal(0)
    })

    it('charge with sufficient account', async () => {
        let limit0Amount = expandTo10Decimals(100);
        let limit1Amount = expandTo10Decimals(200);

        let reward0Amount = expandTo10Decimals(100);
        let reward1Amount = expandTo10Decimals(200);

        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await expect(bootstrap.charge(
            [expandTo10Decimals(100), expandTo10Decimals(200)]
        ))
            .to.emit(reward0Token, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, reward0Amount)
            .to.emit(reward1Token, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, reward1Amount)
            .to.emit(bootstrap, 'ChargeReward')
            .withArgs(wallet.address,
                [reward0Token.address, reward1Token.address],
                [reward0Amount, reward1Amount]
            )

        let rewardAmounts = await bootstrap.getRewardTokenAmounts()
        expect(rewardAmounts[0]).to.equal(reward0Amount)
        expect(rewardAmounts[1]).to.equal(reward1Amount)

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await expect(bootstrap.charge(
            [expandTo10Decimals(100), expandTo10Decimals(200)]
        ))
            .to.emit(reward0Token, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, reward0Amount)
            .to.emit(reward1Token, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, reward1Amount)
            .to.emit(bootstrap, 'ChargeReward')
            .withArgs(wallet.address,
                [reward0Token.address, reward1Token.address],
                [reward0Amount, reward1Amount]
            )

        rewardAmounts = await bootstrap.getRewardTokenAmounts()
        expect(rewardAmounts[0]).to.equal(reward0Amount.mul(2))
        expect(rewardAmounts[1]).to.equal(reward1Amount.mul(2))
    })

    it('not admin withdraw reward should failed', async () => {
        let limit0Amount = expandTo10Decimals(100);
        let limit1Amount = expandTo10Decimals(200);

        let reward0Amount = expandTo10Decimals(100);
        let reward1Amount = expandTo10Decimals(200);

        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await bootstrap.charge([expandTo10Decimals(100), expandTo10Decimals(200)])

        await expect(bootstrap.connect(walletTo).withdrawReward(walletTo.address)).to.be.revertedWith('not admin')

        let reward0Balance = await reward0Token.balanceOf(walletTo.address)
        let reward1Balance = await reward1Token.balanceOf(walletTo.address)
        expect(reward0Balance).to.equal(0)
        expect(reward1Balance).to.equal(0)

        let rewardAmounts = await bootstrap.getRewardTokenAmounts()
        expect(rewardAmounts[0]).to.equal(reward0Amount)
        expect(rewardAmounts[1]).to.equal(reward1Amount)

        let boostrapReward0Amount = await reward0Token.balanceOf(bootstrap.address)
        let boostrapReward1Amount = await reward1Token.balanceOf(bootstrap.address)
        expect(boostrapReward0Amount).to.equal(reward0Amount)
        expect(boostrapReward1Amount).to.equal(reward1Amount)
    })

    it('admin withdraw reward should work', async () => {
        let limit0Amount = expandTo10Decimals(100);
        let limit1Amount = expandTo10Decimals(200);

        let reward0Amount = expandTo10Decimals(100);
        let reward1Amount = expandTo10Decimals(200);

        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await bootstrap.charge([expandTo10Decimals(100), expandTo10Decimals(200)])

        await expect(bootstrap.withdrawReward(walletTo.address))
            .to.emit(reward0Token, 'Transfer')
            .withArgs(bootstrap.address, walletTo.address, reward0Amount)
            .to.emit(reward1Token, 'Transfer')
            .withArgs(bootstrap.address, walletTo.address, reward1Amount)

        let reward0Balance = await reward0Token.balanceOf(walletTo.address)
        let reward1Balance = await reward1Token.balanceOf(walletTo.address)
        expect(reward0Balance).to.equal(reward0Amount)
        expect(reward1Balance).to.equal(reward1Amount)

        let rewardAmounts = await bootstrap.getRewardTokenAmounts()
        expect(rewardAmounts[0]).to.equal(0)
        expect(rewardAmounts[1]).to.equal(0)


        let boostrapReward0Amount = await reward0Token.balanceOf(bootstrap.address)
        let boostrapReward1Amount = await reward1Token.balanceOf(bootstrap.address)
        expect(boostrapReward0Amount).to.equal(0)
        expect(boostrapReward1Amount).to.equal(0)
    })

    it('addPosition in limit', async () => {
        let limit0Amount = expandTo10Decimals(100)
        let limit1Amount = expandTo10Decimals(200)
        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const firstAddedAmount0 = BigNumber.from('14000')
        const firstAddedAmount1 = BigNumber.from('18000')
        await expect(bootstrap.addProvision(address0, address1, firstAddedAmount0, firstAddedAmount1))
            .to.emit(bootstrap, 'Provided')
            .withArgs(wallet.address, firstAddedAmount0, firstAddedAmount1)
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, address0 == token0.address ? firstAddedAmount0 : firstAddedAmount1)
            .to.emit(token1, 'Transfer')
            .withArgs(wallet.address, bootstrap.address, address0 == token0.address ? firstAddedAmount1 : firstAddedAmount0)

        await expect(bootstrap.connect(walletTo).addProvision(address0, address1, firstAddedAmount0, firstAddedAmount1))
            .to.be.revertedWith('CheckLimitFailed')

        await expect(limit0Token.transfer(walletTo.address, limit0Amount))
            .to.emit(limit0Token, 'Transfer')
            .withArgs(wallet.address, walletTo.address, limit0Amount)

        await expect(limit1Token.transfer(walletTo.address, limit1Amount))
            .to.emit(limit1Token, 'Transfer')
            .withArgs(wallet.address, walletTo.address, limit1Amount)


        const secondAddedAmount0 = BigNumber.from('1000')
        const secondAddedAmount1 = BigNumber.from('2000')

        await expect(bootstrap.connect(walletTo).addProvision(address0, address1, secondAddedAmount0, secondAddedAmount1))
            .to.emit(bootstrap, 'Provided')
            .withArgs(walletTo.address, secondAddedAmount0, secondAddedAmount1)
            .to.emit(token0, 'Transfer')
            .withArgs(walletTo.address, bootstrap.address, address0 == token0.address ? secondAddedAmount0 : secondAddedAmount1)
            .to.emit(token1, 'Transfer')
            .withArgs(walletTo.address, bootstrap.address, address0 == token0.address ? secondAddedAmount1 : secondAddedAmount0)
    })

    it('claim with reward', async () => {
        let limit0Amount = expandTo10Decimals(100)
        let limit1Amount = expandTo10Decimals(200)
        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        let reward0Amount = expandTo10Decimals(100);
        let reward1Amount = expandTo10Decimals(200);

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await bootstrap.charge([reward0Amount, reward1Amount])

        let reward0Wallet = await reward0Token.balanceOf(wallet.address)
        let reward1Wallet = await reward1Token.balanceOf(wallet.address)

        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const firstAddedAmount0 = BigNumber.from('14000')
        const firstAddedAmount1 = BigNumber.from('18000')

        await bootstrap.addProvision(address0, address1, firstAddedAmount0, firstAddedAmount1)

        await limit0Token.transfer(walletTo.address, limit0Amount)
        await limit1Token.transfer(walletTo.address, limit1Amount)

        const secondAddedAmount0 = BigNumber.from('1000')
        const secondAddedAmount1 = BigNumber.from('2000')
        await bootstrap.connect(walletTo).addProvision(address0, address1, secondAddedAmount0, secondAddedAmount1)

        await Time.advanceBlockTo(endBlock)
        await factory.setBootstrap(address0, address1, bootstrap.address)
        await bootstrap.mintLiquidity(overrides)

        const pairAddress = await factory.getPair(address0, address1)
        const pair = new Contract(pairAddress, JSON.stringify(Pair.abi), provider).connect(wallet)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)

        const expectWalletLp = await bootstrap.getExactLiquidity(wallet.address, overrides)
        const expectWalletToLp = await bootstrap.getExactLiquidity(walletTo.address, overrides)

        let walletGetReward0Amount = expectWalletLp.mul(reward0Amount).div(liquidtyBalance.add(1000));
        let walletGetReward1Amount = expectWalletLp.mul(reward1Amount).div(liquidtyBalance.add(1000));
        await expect(bootstrap.claim(overrides))
            .to.emit(bootstrap, 'DistributeReward')
            .withArgs(
                wallet.address,
                [reward0Token.address, reward1Token.address],
                [walletGetReward0Amount, walletGetReward1Amount]
            )

        let walletToGetReward0Amount = expectWalletToLp.mul(reward0Amount).div(liquidtyBalance.add(1000));
        let walletToGetReward1Amount = expectWalletToLp.mul(reward1Amount).div(liquidtyBalance.add(1000));
        await expect(bootstrap.connect(walletTo).claim(overrides))
            .to.emit(bootstrap, 'DistributeReward')
            .withArgs(
                walletTo.address,
                [reward0Token.address, reward1Token.address],
                [walletToGetReward0Amount, walletToGetReward1Amount]
            )

        let walletReward0AmountAfterClaim = await reward0Token.balanceOf(wallet.address)
        let walletReward1AmountAfterClaim = await reward1Token.balanceOf(wallet.address)
        expect(walletReward0AmountAfterClaim - reward0Wallet).to.equal(walletGetReward0Amount)
        expect(walletReward1AmountAfterClaim - reward1Wallet).to.equal(walletGetReward1Amount)

        let walletToReward0AmountAfterClaim = await reward0Token.balanceOf(walletTo.address)
        let walletToReward1AmountAfterClaim = await reward1Token.balanceOf(walletTo.address)
        expect(walletToReward0AmountAfterClaim).to.equal(walletToGetReward0Amount)
        expect(walletToReward1AmountAfterClaim).to.equal(walletToGetReward1Amount)
    })

    it('estimate reward token amounts', async() =>{
        let limit0Amount = expandTo10Decimals(100)
        let limit1Amount = expandTo10Decimals(200)
        await bootstrap.setRewardAndLimit(
            [reward0Token.address, reward1Token.address],
            [limit0Token.address, limit1Token.address],
            [limit0Amount, limit1Amount]
        )

        let reward0Amount = expandTo10Decimals(100);
        let reward1Amount = expandTo10Decimals(200);

        await reward0Token.approve(bootstrap.address, reward0Amount)
        await reward1Token.approve(bootstrap.address, reward1Amount)

        await bootstrap.charge([reward0Amount, reward1Amount])

        const [address0, address1] = getSortedAddress(token0.address, token1.address)
        const firstAddedAmount0 = BigNumber.from('14000')
        const firstAddedAmount1 = BigNumber.from('18000')

        await bootstrap.addProvision(address0, address1, firstAddedAmount0, firstAddedAmount1)

        await limit0Token.transfer(walletTo.address, limit0Amount)
        await limit1Token.transfer(walletTo.address, limit1Amount)

        const secondAddedAmount0 = BigNumber.from('1000')
        const secondAddedAmount1 = BigNumber.from('2000')
        await bootstrap.connect(walletTo).addProvision(address0, address1, secondAddedAmount0, secondAddedAmount1)


        let estimateWalletRewards = await bootstrap.estimateRewardTokenAmounts(wallet.address)

        const expectWalletLp = await bootstrap.getExactLiquidity(wallet.address, overrides)
        const expectWalletToLp = await bootstrap.getExactLiquidity(walletTo.address, overrides)
        const totalLiquidity = await bootstrap.getTotalLiquidity()
        
        expect(estimateWalletRewards[0]).to.equal(expectWalletLp.mul(reward0Amount).div(totalLiquidity))
        expect(estimateWalletRewards[1]).to.equal(expectWalletLp.mul(reward1Amount).div(totalLiquidity))

        let estimateWalletToRewards = await bootstrap.estimateRewardTokenAmounts(walletTo.address)
        expect(estimateWalletToRewards[0]).to.equal(expectWalletToLp.mul(reward0Amount).div(totalLiquidity))
        expect(estimateWalletToRewards[1]).to.equal(expectWalletToLp.mul(reward1Amount).div(totalLiquidity))
    })
})