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
    let router: Contract;
    let WNativeCurrency: Contract;

    beforeEach(async function () {
        const fixture = await loadFixture(routerFixture)
        factory = fixture.factory
        token0 = fixture.token0
        token1 = fixture.token1
        router = fixture.router
        WNativeCurrency = fixture.nativeCurrency
    })

    it('factory, WNativeCurrency', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.WNativeCurrency()).to.eq(WNativeCurrency.address)
    })

    it('addLiquidity', async () => {
        let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        await expect(factory.createPair(token0.address, token1.address))
            .to.emit(factory, 'PairCreated')
            .withArgs(tokens[0].address, tokens[1].address, create2Address, BigNumber.from(1))

        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        let amounts = token0.address > token1.address ? [token1Amount, token0Amount] : [token0Amount, token1Amount]

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, constants.MaxUint256)
        await token1.approve(router.address, constants.MaxUint256)
        await expect(
            router.addLiquidity(
                tokens[0].address,
                tokens[1].address,
                amounts[0],
                amounts[1],
                0,
                0,
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(wallet.address, create2Address, amounts[0])
            .to.emit(tokens[1], 'Transfer')
            .withArgs(wallet.address, create2Address, amounts[1])
            .to.emit(pair, 'Transfer')
            .withArgs(constants.AddressZero, wallet.address, MINIMUM_LIQUIDITY)
            .to.emit(pair, 'Transfer')
            .withArgs(constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, 'Mint')
            .withArgs(router.address, amounts[0], amounts[1])

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity)
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
        let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        let amounts = token0.address > token1.address ? [token1Amount, token0Amount] : [token0Amount, token1Amount]

        await addLiquidity(tokens[0], tokens[1], amounts[0], amounts[1])

        const expectedLiquidity = expandTo18Decimals(2)
        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await pair.approve(router.address, constants.MaxUint256)
        await expect(
            router.removeLiquidity(
                tokens[0].address,
                tokens[1].address,
                expectedLiquidity,
                0,
                0,
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(pair, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedLiquidity)
            .to.emit(tokens[0], 'Transfer')
            .withArgs(pair.address, wallet.address, amounts[0])
            .to.emit(tokens[1], 'Transfer')
            .withArgs(pair.address, wallet.address, amounts[1])
            .to.emit(pair, 'Burn')
            .withArgs(router.address, amounts[0], amounts[1], wallet.address)
    })

    it('swapExactTokensForTokens', async () => {
        let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = BigNumber.from('1662497915624478906')

        await addLiquidity(tokens[0], tokens[1], token0Amount, token1Amount)
        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await expect(
            router.swapExactTokensForTokens(
                swapAmount,
                0,
                [tokens[0].address, tokens[1].address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(tokens[1], 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
    })

    it('swapTokensForExactTokens', async () => {
        let tokens = token0.address > token1.address ? [token1, token0] : [token0, token1]

        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = BigNumber.from('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        await addLiquidity(tokens[0], tokens[1], token0Amount, token1Amount)
        await token0.approve(router.address, constants.MaxUint256)

        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, [token0.address, token1.address], bytecode)
        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider).connect(wallet);

        await token0.approve(router.address, constants.MaxUint256)
        await expect(
            router.swapTokensForExactTokens(
                outputAmount,
                constants.MaxUint256,
                [tokens[0].address, tokens[1].address],
                wallet.address,
                constants.MaxUint256,
                overrides
            )
        )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(tokens[1], 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
    })

});