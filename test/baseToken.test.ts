import { expect, use } from "chai";
const { waffle } = require("hardhat");
const { solidity, deployContract, wallet, walletTo } = waffle;

import BasicToken from '../build/contracts/test/BasicToken.sol/BasicToken.json'


use(solidity);

const overrides = {
    gasLimit: 9999999
}

describe('BaseToken', () => {
    let provider = waffle.provider;
    const [wallet, walletTo] = provider.getWallets();
    let token: any;

    beforeEach(async () => {
        token = await deployContract(wallet, BasicToken, ["Basic", 'BSC', 1000]);
    });

    it('Assigns initial balance', async () => {
        expect(await token.name()).to.equal("Basic");
        expect(await token.symbol()).to.equal("BSC");
        expect(await token.balanceOf(wallet.address)).to.equal(1000);
    });
});