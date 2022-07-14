import { HardhatUserConfig } from 'hardhat/types';
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-waffle"
import "@nomiclabs/hardhat-web3"
import "@nomiclabs/hardhat-etherscan"
import "hardhat-gas-reporter"
import "solidity-coverage"
import "hardhat-deploy"
import "hardhat-spdx-license-identifier"


const config: HardhatUserConfig = {
    paths: {
        sources: "./contracts",
        artifacts: "./build"
    },
    networks: {
        hardhat: {
          gas: 120000000,
          blockGasLimit: 0x1fffffffffffff,
        }
    },
    solidity: {
        compilers: [
            {
                version: '0.8.7',
                settings: {
                    optimizer: { enabled: true, runs: 200 },
                    evmVersion: 'istanbul',
                },
            }
        ],
    }
};

export default config;
