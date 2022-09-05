import { HardhatUserConfig } from 'hardhat/types';

import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-waffle"
import "@nomiclabs/hardhat-web3"
import "@nomiclabs/hardhat-etherscan"
import "hardhat-gas-reporter"
import "solidity-coverage"
import "hardhat-deploy"
import "hardhat-spdx-license-identifier"

import dotenv from "dotenv"
import { Deployment } from 'hardhat-deploy/types';
import { task } from "hardhat/config"

dotenv.config()

let config: HardhatUserConfig = {
  paths: {
    sources: "./contracts",
    artifacts: "./build"
  },
  networks: {
    hardhat: {
      gas: 1200000000,
      blockGasLimit: 0x1fffffffffffff,
    },
    moonbase: {
      url: 'https://rpc.testnet.moonbeam.network',
      chainId: 1287,
      deploy: ["./deploy/moonbase/"]
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.8.7',
        settings: {
          optimizer: { enabled: true, runs: 200 }
        },
      }
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1287: 0
    },
    libraryDeployer: {
      default: 1,
      1287: 1
    }
  }
};

if (process.env.ACCOUNT_PRIVATE_KEYS) {
  config.networks = {
    ...config.networks,
    moonbase: {
      ...config.networks?.moonbase,
      accounts: JSON.parse(process.env.ACCOUNT_PRIVATE_KEYS)
    }
  }
}

// Override the default deploy task
task("deploy", async (taskArgs, hre, runSuper) => {
  const { all } = hre.deployments
  /*
   * Pre-deployment actions
   */

  // Load exiting deployments
  const existingDeployments: { [p: string]: Deployment } = await all()
  // Create hard copy of existing deployment name to address mapping
  const existingDeploymentToAddressMap: { [p: string]: string } = Object.keys(
    existingDeployments,
  ).reduce((acc: { [p: string]: string }, key) => {
    acc[key] = existingDeployments[key].address
    return acc
  }, {})

  /*
   * Run super task
   */
  await runSuper(taskArgs)

  /*
   * Post-deployment actions
   */
  const updatedDeployments: { [p: string]: Deployment } = await all()

  // Filter out any existing deployments that have not changed
  const newDeployments: { [p: string]: Deployment } = Object.keys(
    updatedDeployments,
  ).reduce((acc: { [p: string]: Deployment }, key) => {
    if (
      !existingDeploymentToAddressMap.hasOwnProperty(key) ||
      existingDeploymentToAddressMap[key] !== updatedDeployments[key].address
    ) {
      acc[key] = updatedDeployments[key]
    }
    return acc
  }, {})

  // Print the new deployments to the console
  if (Object.keys(newDeployments).length > 0) {
    console.log("\nNew deployments:")
    console.table(
      Object.keys(newDeployments).map((k) => [k, newDeployments[k].address]),
    )
  } else {
    console.warn("\nNo new deployments found")
  }
})


export default config;
