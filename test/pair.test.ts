import { expect, use } from "chai";
import { ethers, Contract, providers } from "ethers";
import { deployContract, solidity, MockProvider, loadFixture, createFixtureLoader } from "ethereum-waffle";
import { pairFixture } from './shared/fixtures'
import { expandTo18Decimals } from './shared/utilities'

use(solidity);

const overrides = {
    gasLimit: 9999999
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
        
        
    });
});