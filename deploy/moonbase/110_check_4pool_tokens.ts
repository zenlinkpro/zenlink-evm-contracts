import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"
import { isTestNetwork } from "../../utils/network"

const USD_TOKENS_ARGS: { [token: string]: any[] } = {
  DAI: ["Dai Stablecoin", "DAI", "18", "0"],
  USDC: ["USD Coin", "USDC", "6", "0"],
  USDT: ["Tether USD", "USDT", "6", "0"],
  FRAX: ["Frax", "FRAX", "18", "0"]
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre
  const { deploy, execute, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  for (const token in USD_TOKENS_ARGS) {
    const token_contracts = await getOrNull(token)
    if (!token_contracts) {
      await deploy(token, {
        from: deployer,
        log: true,
        contract: "BasicToken",
        args: USD_TOKENS_ARGS[token],
        skipIfAlreadyDeployed: true,
      })
      // If it's on hardhat, mint test tokens
      if (isTestNetwork(await getChainId())) {
        const decimals = USD_TOKENS_ARGS[token][2]
        await execute(
          token,
          { from: deployer, log: true },
          "setBalance",
          deployer,
          BigNumber.from(10).pow(decimals).mul(1000000),
        )
      }
    } else {
      log(`reusing ${token} at ${token_contracts.address}`)
    }
  }
}
export default func
func.tags = ["Moonbase4PoolTokens"]
