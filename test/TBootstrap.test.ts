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

async function advanceEndBlock (
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

        expect(balance0AfterFirstAdded.sub(balance0AfterSecondAdded)).to.equal(BigNumber.from('2000'))
        expect(balance1AfterFirstAdded.sub(balance1AfterSecondAdded)).to.equal(BigNumber.from('1000'))

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
        const exceptWalletLp = await bootstrap.getExactLiquidity(wallet.address, overrides)
        const exceptWalletToLp = await bootstrap.getExactLiquidity(walletTo.address, overrides)
        await bootstrap.claim(overrides)
        await bootstrap.connect(walletTo).claim(overrides)
        const walletLpBalance = await pair.balanceOf(wallet.address)
        const walletToLpBalance = await pair.balanceOf(walletTo.address)
        const liquidtyBalance = await pair.balanceOf(bootstrap.address)
        // minumLiquidity minted to factory deployer
        expect(exceptWalletLp).to.equal(walletLpBalance.sub('1000'))
        expect(exceptWalletToLp).to.equal(walletToLpBalance)
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

    it('withdrawExtraFunds', async() => {
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
})