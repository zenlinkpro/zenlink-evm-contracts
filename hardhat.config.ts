import "@nomicfoundation/hardhat-toolbox"
import "@nomicfoundation/hardhat-chai-matchers";
import "hardhat-deploy"
import "hardhat-spdx-license-identifier"
import "hardhat-abi-exporter"

import dotenv from "dotenv"
import { Deployment } from 'hardhat-deploy/types';
import { HardhatUserConfig, task } from "hardhat/config"

dotenv.config()

const config: HardhatUserConfig = {
  abiExporter: {
    path: "./abi",
    clear: false,
    flat: true,
    runOnCompile: true,
    except: ['ERC20.sol']
  },
  paths: {
    artifacts: "artifacts",
    cache: "cache",
    deploy: "deploy",
    deployments: "deployments",
    imports: "imports",
    sources: "contracts",
    tests: "test",
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    astar: {
      url: 'https://astar.api.onfinality.io/public',
      chainId: 592,
      deploy: ['./deploy/astar/']
    },
    moonbase: {
      url: 'https://rpc.testnet.moonbeam.network',
      chainId: 1287,
      deploy: ['./deploy/moonbase/'],
      verify: {
        etherscan: {
          apiUrl: 'https://api-moonbase.moonscan.io',
          apiKey: 'NO_KEY',
        }
      }
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
      592: 0,
      1287: 0,
    },
    libraryDeployer: {
      default: 1,
      592: 1,
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
    },
    astar: {
      ...config.networks?.astar,
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
