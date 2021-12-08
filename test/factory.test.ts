import { expect, use } from "chai";
import { Contract, BigNumber } from "ethers";
import { solidity, MockProvider } from 'ethereum-waffle'
import { factoryFixture } from './shared/fixtures'
import { getCreate2Address } from './shared/utilities'

import Pair from '../build/contracts/core/Pair.sol/Pair.json'


use(solidity);

const TEST_ADDRESSES: [string, string] = [
    '0x1000000000000000000000000000000000000000',
    '0x2000000000000000000000000000000000000000'
]

describe('Factory', () => {
    const provider = new MockProvider({
        ganacheOptions: {
          hardfork: 'istanbul',
          mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
          gasLimit: 9999999,
        },
    })

    const [wallet, walletTo] = provider.getWallets();

    let factory: Contract
    beforeEach(async () => {
        const fixture = await factoryFixture(wallet)
        factory = fixture.factory
    })

    async function createPair(tokens: [string, string]) {
        const bytecode = Pair.bytecode
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

        const pair = new Contract(create2Address, JSON.stringify(Pair.abi), wallet)
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

    it('setAdmin', async () => {
        await expect(factory.connect(walletTo).setAdminCandidate(walletTo.address)).to.be.revertedWith('not admin')
        await factory.setAdminCandidate(walletTo.address)
        await factory.connect(walletTo).candidateConfirm()
        expect(await factory.admin()).to.eq(walletTo.address)
    })

    it('setFeeBasePoint', async () => {
        const feeBasePoint = 5;
        await expect(factory.connect(walletTo).setFeeBasePoint(feeBasePoint)).to.be.revertedWith('not admin')
        await factory.setFeeBasePoint(feeBasePoint)
        expect(await factory.feeBasePoint()).to.eq(feeBasePoint)

        await expect(factory.connect(walletTo).setFeeBasePoint(31)).to.be.revertedWith('not admin')
    })
})