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
});