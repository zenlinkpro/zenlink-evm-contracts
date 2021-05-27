import { expect, use } from "chai";
import { ethers, Contract, constants, providers, BigNumber } from "ethers";
import { deployContract, solidity, MockProvider, loadFixture, createFixtureLoader } from "ethereum-waffle";
import { pairFixture } from './shared/fixtures'
import { expandTo18Decimals } from './shared/utilities'

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3)

use(solidity);

const overrides = {
    gasLimit: 4100000
}

describe('Pair', () => {
    const testProvider = new MockProvider();
    const [wallet, walletTo] = testProvider.getWallets();

    const loadFixture = createFixtureLoader([wallet], testProvider);

    let factory: Contract;
    let token0: Contract;
    let token1: Contract;
    let pair: Contract;

    beforeEach(async () => {
        const fixture = await loadFixture(pairFixture)
        factory = fixture.factory
        token0 = fixture.token0
        token1 = fixture.token1
        pair = fixture.pair
    });

    it('mint', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2);
        await expect(pair.mint(wallet.address, overrides))
            .to.emit(pair, 'Transfer')
            .withArgs(constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, 'Mint')
            .withArgs(wallet.address, token0Amount, token1Amount)

        expect(await pair.totalSupply()).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        expect(await token0.balanceOf(pair.address)).to.eq(token0Amount);
        expect(await token1.balanceOf(pair.address)).to.eq(token1Amount);
        const reserves = await pair.getReserves();
        expect(BigNumber.from(reserves[0])).to.eq(token0Amount);
        expect(BigNumber.from(reserves[1])).to.eq(token1Amount);
    });

    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
    }

    const swapTestCase: BigNumber[][] = [
        [1, 5, 10, '1662497915624478906'],
        [1, 10, 5, '453305446940074565'],

        [2, 5, 10, '2851015155847869602'],
        [2, 10, 5, '831248957812239453'],

        [1, 10, 10, '906610893880149131'],
        [1, 100, 100, '987158034397061298'],
        [1, 1000, 1000, '996006981039903216']
    ].map(a => a.map(n => (typeof n == 'string' ? BigNumber.from(n) : expandTo18Decimals(n))));
    swapTestCase.forEach((swapTestCase, i) => {
        it(`getInputPrice:${i}`, async () => {
            const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase
            await addLiquidity(token0Amount, token1Amount)
            await token0.transfer(pair.address, swapAmount)
            await expect(pair.swap(0, expectedOutputAmount.add(1), wallet.address, overrides)).to.be.revertedWith(
                'Pair: K'
            )
            await pair.swap(0, expectedOutputAmount, wallet.address, overrides)
        })
    });

    const optimisticTestCases: BigNumber[][] = [
        ['997000000000000000', 5, 10, 1],
        ['997000000000000000', 10, 5, 1],
        ['997000000000000000', 5, 5, 1],
        [1, 5, 5, '1003009027081243732']
    ].map(a => a.map(n => (typeof n === 'string' ? BigNumber.from(n) : expandTo18Decimals(n))))
    optimisticTestCases.forEach((optimisticTestCase, i) => {
        it(`optimistic:${i}`, async () => {
            const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase
            await addLiquidity(token0Amount, token1Amount)
            await token0.transfer(pair.address, inputAmount)
            await expect(pair.swap(outputAmount.add(1), 0, wallet.address, overrides)).to.be.revertedWith(
                'Pair: K'
            )
            await pair.swap(outputAmount, 0, wallet.address, overrides)
        })
    })

    it('swap:token0', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        await addLiquidity(token0Amount, token1Amount)

        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = BigNumber.from('1662497915624478906')
        await token0.transfer(pair.address, swapAmount)
        await expect(pair.swap(0, expectedOutputAmount, wallet.address, overrides))
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(wallet.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)

        const reserves = await pair.getReserves()
        expect(BigNumber.from(reserves[0])).to.eq(token0Amount.add(swapAmount))
        expect(BigNumber.from(reserves[1])).to.eq(token1Amount.sub(expectedOutputAmount))
        expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.add(swapAmount))
        expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.sub(expectedOutputAmount))
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))
    })

    it('swap:token1', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        await addLiquidity(token0Amount, token1Amount)

        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = BigNumber.from('453305446940074565')
        await token1.transfer(pair.address, swapAmount)
        await expect(pair.swap(expectedOutputAmount, 0, wallet.address, overrides))
            .to.emit(token0, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(wallet.address, 0, swapAmount, expectedOutputAmount, 0, wallet.address)

        const reserves = await pair.getReserves()
        expect(BigNumber.from(reserves[0])).to.eq(token0Amount.sub(expectedOutputAmount))
        expect(BigNumber.from(reserves[1])).to.eq(token1Amount.add(swapAmount))
        expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.sub(expectedOutputAmount))
        expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.add(swapAmount))
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).sub(swapAmount))
    })

    it('burn', async () => {
        const token0Amount = expandTo18Decimals(3)
        const token1Amount = expandTo18Decimals(3)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(3)
        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        await expect(pair.burn(wallet.address, overrides))
            .to.emit(token0, 'Transfer')
            .withArgs(pair.address, wallet.address, token0Amount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, token1Amount)
            .to.emit(pair, 'Burn')
            .withArgs(wallet.address, token0Amount, token1Amount, wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        expect(await pair.totalSupply()).to.eq(0)
        expect(await token0.balanceOf(pair.address)).to.eq(0)
        expect(await token1.balanceOf(pair.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0)
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1)
    })
});