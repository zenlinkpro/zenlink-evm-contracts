import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const stableSwapRouter = await getOrNull('StableSwapRouter')

  if (stableSwapRouter) {
    log(`reusing "StableSwapRouter" at ${stableSwapRouter.address}`)
  } else {
    await deploy('StableSwapRouter', {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['StableSwapRouter'];
