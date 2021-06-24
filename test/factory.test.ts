import { expect, use } from "chai";
import { Contract, constants, BigNumber } from "ethers";
import { solidity, MockProvider, createFixtureLoader } from "ethereum-waffle";
import { factoryFixture } from './shared/fixtures'
import { getCreate2Address } from './shared/utilities'

import Pair from '../build/Pair.json'


use(solidity);

const TEST_ADDRESSES: [string, string] = [
    '0x1000000000000000000000000000000000000000',
    '0x2000000000000000000000000000000000000000'
]

describe('Factory', () => {
    const testProvider = new MockProvider()
    const [wallet, walletTo] = testProvider.getWallets()

    const loadFixture = createFixtureLoader([wallet], testProvider)
    let factory: Contract
    beforeEach(async () => {
        const fixture = await loadFixture(factoryFixture)
        factory = fixture.factory
    })

    async function createPair(tokens: [string, string]) {
        const bytecode = `0x${Pair.evm.bytecode.object}`
        const create2Address = getCreate2Address(factory.address, tokens, bytecode)
        await expect(factory.createPair(...tokens))
            .to.emit(factory, 'PairCreated')
            .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, BigNumber.from(1))

        await expect(factory.createPair(...tokens)).to.be.reverted
        await expect(factory.createPair(...tokens.slice().reverse())).to.be.reverted
        expect(await factory.getPair(...tokens)).to.eq(create2Address)
        expect(await factory.getPair(...tokens.slice().reverse())).to.eq(create2Address)
        expect(await factory.allPairs(0)).to.eq(create2Address)
        expect(await factory.allPairsLength()).to.eq(1)

        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), testProvider)
        expect(await pair.factory()).to.eq(factory.address)
        expect(await pair.token0()).to.eq(TEST_ADDRESSES[0])
        expect(await pair.token1()).to.eq(TEST_ADDRESSES[1])
    }

    it('createPair', async () => {
        await createPair(TEST_ADDRESSES)
        expect(await factory.allPairsLength()).to.eq(1);
    })

    it('createPair:reverse', async () => {
        await createPair(TEST_ADDRESSES.slice().reverse() as [string, string])
        expect(await factory.allPairsLength()).to.eq(1);
    })

    it('setFeeTo', async () => {
        await expect(factory.connect(walletTo).setFeeTo(walletTo.address)).to.be.revertedWith('FORBIDDEN')
        await factory.setFeeTo(wallet.address)
        expect(await factory.feeTo()).to.eq(wallet.address)
    })

    it('setFeeBasePoint', async () => {
        const feeBasePoint = 5;
        await expect(factory.connect(walletTo).setFeeBasePoint(feeBasePoint)).to.be.revertedWith('FORBIDDEN')
        await factory.setFeeBasePoint(feeBasePoint)
        expect(await factory.feeBasePoint()).to.eq(feeBasePoint)
    })
})