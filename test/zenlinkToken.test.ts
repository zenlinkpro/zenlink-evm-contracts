import { expect, use } from "chai";
import { Contract, constants } from "ethers";
import { MockProvider, solidity } from "ethereum-waffle";
import { ZenlinkTokenFixture } from './shared/fixtures'
import { expandTo18Decimals } from './shared/utilities'
import { Address } from "ethereumjs-util";

use(solidity);

const overrides = {
    gasLimit: 4100000
}

describe('ZenlinkToken', () => {
    const provider = new MockProvider({
        ganacheOptions: {
          hardfork: 'istanbul',
          mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
          gasLimit: 9999999,
        },
    })
    const [wallet, walletTo] = provider.getWallets();

    let zenlinkToken: Contract
    beforeEach(async () => {
        const fixture = await ZenlinkTokenFixture(wallet)
        zenlinkToken = fixture.zenlinkToken
        await zenlinkToken.transfer(walletTo.address, expandTo18Decimals(2), overrides)
    })

    it("mint", async () => {
        await expect(zenlinkToken.connect(walletTo).mint(expandTo18Decimals(1), overrides)).to.be.revertedWith('not admin')

        await expect(zenlinkToken.connect(wallet).mint(expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(constants.AddressZero, wallet.address, expandTo18Decimals(1))

        await expect(zenlinkToken.connect(wallet).mint('40000000000000000000000000', overrides))
            .to.revertedWith("can't mint")
    })

    it("transfer only admin", async () => {
        await expect(zenlinkToken.transfer(walletTo.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))

        await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)
    })

    it('transferFrom only admin', async () => {
        await zenlinkToken.connect(walletTo).approve(wallet.address, expandTo18Decimals(1), overrides);
        await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1), overrides);

        await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)

        await expect(zenlinkToken.transferFrom(walletTo.address, wallet.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))
    })

    it('whitelist', async () => {
        await expect(zenlinkToken.connect(walletTo).addWhitelist(walletTo.address, overrides)).to.be.revertedWith('not admin')
        await zenlinkToken.addWhitelist(walletTo.address, overrides)

        await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))


        await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1))
        await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))

        await expect(zenlinkToken.connect(walletTo).removeWhitelist(walletTo.address, overrides)).to.be.revertedWith('not admin')
        await zenlinkToken.removeWhitelist(walletTo.address, overrides)

        await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)
        await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)
    })

    it('global transferable switch', async () => {
        await expect(zenlinkToken.connect(walletTo).enableTransfer( overrides)).to.be.revertedWith('not admin')
        await zenlinkToken.enableTransfer(overrides)
        await expect(zenlinkToken.connect(walletTo).disableTransfer(overrides)).to.be.revertedWith('not admin')

        await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(walletTo.address, wallet.address, expandTo18Decimals(1))


        await zenlinkToken.approve(walletTo.address, expandTo18Decimals(1))
        await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1), overrides))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(wallet.address, walletTo.address, expandTo18Decimals(1))


        await zenlinkToken.disableTransfer(overrides)

        await expect(zenlinkToken.connect(walletTo).transferFrom(wallet.address, walletTo.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)
        await expect(zenlinkToken.connect(walletTo).transfer(wallet.address, expandTo18Decimals(1), overrides))
            .to.be.revertedWith(`can't transfer`)
    })

    it('burn', async() =>{
        await zenlinkToken.enableTransfer(overrides)

        let totalSupplyBeforeBurn = await zenlinkToken.totalSupply();

        await expect(zenlinkToken.burn("15000000000000000000000000"))
            .to.emit(zenlinkToken, "Transfer")
            .withArgs(wallet.address, Address.zero().toString(), "15000000000000000000000000");
        
        let totalSupplyAfterBurn = await zenlinkToken.totalSupply();
        let balanceAfterBurn = await zenlinkToken.balanceOf(wallet.address);

        expect(totalSupplyBeforeBurn - totalSupplyAfterBurn).to.be.equals(15000000000000000000000000);
        expect(balanceAfterBurn).to.be.equal("14999998000000000000000000");
    })
})