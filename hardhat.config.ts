import { HardhatUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-waffle';

const config: HardhatUserConfig = {
    paths: {
        sources: "./contracts",
        artifacts: "./build",
    },
    solidity: {
        compilers: [
            {
                version: '0.8.0',
                settings: {
                    optimizer: { enabled: true, runs: 200 },
                    evmVersion: 'istanbul',
                },
            }
        ],
    }
};

export default config;