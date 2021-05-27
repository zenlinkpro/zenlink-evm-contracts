import { expect, use } from "chai";
import { Contract, constants, BigNumber } from "ethers";
import { solidity, MockProvider, createFixtureLoader } from "ethereum-waffle";
import { pairFixture, routerFixture } from './shared/fixtures'

import { getCreate2Address } from './shared/utilities'
import { expandTo18Decimals } from './shared/utilities'
import Pair from '../build/Pair.json'
import { isHexString } from "@ethersproject/bytes";

use(solidity);

const overrides = {
    gasLimit: 4100000
}

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3)


describe('Router', () => {
    const testProvider = new MockProvider();
    const [wallet, walletTo] = testProvider.getWallets();

    const loadFixture = createFixtureLoader([wallet], testProvider);

    let factory: Contract;
    let token0: Contract;
    let token1: Contract;
    let token2: Contract;
    let router: Contract;

    beforeEach(async function () {
        const fixture = await loadFixture(routerFixture)
        factory = fixture.factory
        token0 = fixture.token0
        token1 = fixture.token1
        token2 = fixture.token2
        router = fixture.router
    })

    it('addLiquidity', async () => {
        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        await expect(factory.createPair(token0.address, token1.address))
            .to.emit(factory, 'PairCreated')
            .withArgs(token1.address, token0.address, create2Address, BigNumber.from(1))

        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, constants.MaxUint256)
        await token1.approve(router.address, constants.MaxUint256)
        await expect(
            router.addLiquidity(
                token0.address,
                token1.address,
                token0Amount,
                token1Amount,
                0,
                0,
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(token1, 'Transfer')
            .withArgs(wallet.address, create2Address, token1Amount)
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, create2Address, token0Amount)
            .to.emit(pair, 'Transfer')
            .withArgs(constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, 'Mint')
            .withArgs(router.address, token1Amount, token0Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    async function addLiquidity(token0: Contract, token1: Contract, token0Amount: BigNumber, token1Amount: BigNumber) {
        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        await factory.createPair(token0.address, token1.address)

        await token0.transfer(create2Address, token0Amount)
        await token1.transfer(create2Address, token1Amount)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);
        await pair.mint(wallet.address, overrides)
    }

    it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0, token1, token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await pair.approve(router.address, constants.MaxUint256)
        await expect(
            router.removeLiquidity(
                token0.address,
                token1.address,
                expectedLiquidity.sub(MINIMUM_LIQUIDITY),
                0,
                0,
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(pair, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, token1Amount)
            .to.emit(token0, 'Transfer')
            .withArgs(pair.address, wallet.address, token0Amount)
            .to.emit(pair, 'Burn')
            .withArgs(router.address, token1Amount, token0Amount, wallet.address)
    })

    it('swapExactTokensForTokens', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = BigNumber.from('1662497915624478906')

        await addLiquidity(token0, token1, token0Amount, token1Amount)
        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await expect(
            router.swapExactTokensForTokens(
                swapAmount,
                0,
                [token0.address, token1.address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(router.address, 0, swapAmount, expectedOutputAmount, 0, wallet.address)
    })

    it('swapExactTokensForTokensByMultiPair', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const token2Amount = expandTo18Decimals(20)

        const swapAmount = expandTo18Decimals(1)
        const expectedToken1OutputAmount = BigNumber.from('1662497915624478906')
        const expectedToken2OutputAmount = BigNumber.from('2843678215834080602')


        await addLiquidity(token0, token1, token0Amount, token1Amount)
        await addLiquidity(token1, token2, token1Amount, token2Amount)

        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair0 = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        const create2Address1 = getCreate2Address(factory.address, [token1.address, token2.address], bytecode)
        const pair1 = new Contract(create2Address1, JSON.stringify(Pair.abi), testProvider).connect(wallet);
        await expect(
            router.swapExactTokensForTokens(
                swapAmount,
                0,
                [token0.address, token1.address, token2.address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair0.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair0.address, pair1.address, expectedToken1OutputAmount)
            .to.emit(pair0, 'Swap')
            .withArgs(router.address, 0, swapAmount, expectedToken1OutputAmount, 0, pair1.address)
            .to.emit(token2, 'Transfer')
            .withArgs(pair1.address, wallet.address, expectedToken2OutputAmount)
            .to.emit(pair1, 'Swap')
            .withArgs(router.address, expectedToken1OutputAmount, 0, 0, expectedToken2OutputAmount, wallet.address);


        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        const totalSupplyToken2 = await token2.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount.mul(2)))
        expect(await token2.balanceOf(wallet.address)).to.eq(totalSupplyToken2.sub(token2Amount).add(expectedToken2OutputAmount))

        expect(await token0.balanceOf(pair0.address)).to.eq(token0Amount.add(swapAmount))
        expect(await token1.balanceOf(pair0.address)).to.eq(token1Amount.sub(expectedToken1OutputAmount))

        expect(await token1.balanceOf(pair1.address)).to.eq(token1Amount.add(expectedToken1OutputAmount))
        expect(await token2.balanceOf(pair1.address)).to.eq(token2Amount.sub(expectedToken2OutputAmount))
    })

    it('swapTokensForExactTokens', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = BigNumber.from('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        await addLiquidity(token0, token1, token0Amount, token1Amount)
        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await token0.approve(router.address, constants.MaxUint256)
        await expect(
            router.swapTokensForExactTokens(
                outputAmount,
                constants.MaxUint256,
                [token0.address, token1.address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(router.address, 0, expectedSwapAmount, outputAmount, 0, wallet.address)
    })

    it('swapTokensForExactTokensByMultiPair', async () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const token2Amount = expandTo18Decimals(20)

        const expectedOutputAmount = expandTo18Decimals(1)
        const token0InputAmount = BigNumber.from('279498697843516618')
        const token1OutputAmount = BigNumber.from('527899487937496701')


        await addLiquidity(token0, token1, token0Amount, token1Amount)
        await addLiquidity(token1, token2, token1Amount, token2Amount)

        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair0 = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        const create2Address1 = getCreate2Address(factory.address, [token1.address, token2.address], bytecode)
        const pair1 = new Contract(create2Address1, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await expect(
            router.swapTokensForExactTokens(
                expectedOutputAmount,
                constants.MaxUint256,
                [token0.address, token1.address, token2.address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair0.address, token0InputAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair0.address, pair1.address, token1OutputAmount)
            .to.emit(pair0, 'Swap')
            .withArgs(router.address, 0, token0InputAmount, token1OutputAmount, 0, pair1.address)
            .to.emit(token2, 'Transfer')
            .withArgs(pair1.address, wallet.address, expectedOutputAmount)
            .to.emit(pair1, 'Swap')
            .withArgs(router.address, token1OutputAmount, 0, 0, expectedOutputAmount, wallet.address)


        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        const totalSupplyToken2 = await token2.totalSupply()

        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(token0InputAmount))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount.mul(2)))
        expect(await token2.balanceOf(wallet.address)).to.eq(totalSupplyToken2.sub(token2Amount).add(expectedOutputAmount))

        expect(await token0.balanceOf(pair0.address)).to.eq(token0Amount.add(token0InputAmount))
        expect(await token1.balanceOf(pair0.address)).to.eq(token1Amount.sub(token1OutputAmount))

        expect(await token1.balanceOf(pair1.address)).to.eq(token1Amount.add(token1OutputAmount))
        expect(await token2.balanceOf(pair1.address)).to.eq(token2Amount.sub(expectedOutputAmount))
    })
});