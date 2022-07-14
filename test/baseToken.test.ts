import { expect, use } from "chai";
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract } from "ethers";

import BasicToken from '../build/contracts/test/BasicToken.sol/BasicToken.json'

use(solidity);

describe('BaseToken', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet] = provider.getWallets();
  let token: Contract;

  beforeEach(async () => {
    token = await deployContract(wallet, BasicToken, ["Basic", 'BSC', 18, 1000]);
  });

  it('Assigns initial balance', async () => {
    expect(await token.name()).to.equal("Basic");
    expect(await token.symbol()).to.equal("BSC");
    expect(await token.balanceOf(wallet.address)).to.equal(1000);
  });
});
