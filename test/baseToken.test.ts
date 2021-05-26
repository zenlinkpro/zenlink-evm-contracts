import { expect, use } from "chai";
import { ethers, Contract } from "ethers";
import { deployContract, solidity, MockProvider } from "ethereum-waffle";

import BasicToken from '../build/BasicToken.json';


use(solidity);

const overrides = {
    gasLimit: 9999999
}

describe('BaseToken', () => {
    const [wallet, walletTo] = new MockProvider().getWallets();
    let token: Contract;

    beforeEach(async () => {
        token = await deployContract(wallet, BasicToken, ["Basic", 'BSC', 1000]);
    });

    it('Assigns initial balance', async () => {
        expect(await token.name()).to.equal("Basic");
        expect(await token.symbol()).to.equal("BSC");
        expect(await token.balanceOf(wallet.address)).to.equal(1000);
    });
});