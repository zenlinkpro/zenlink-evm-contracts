import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const stableSwapDispatcher = await getOrNull('StableSwapDispatcher')

  if (stableSwapDispatcher) {
    log(`reusing "StableSwapDispatcher" at ${stableSwapDispatcher.address}`)
  } else {
    const wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    await deploy('StableSwapDispatcher', {
      from: deployer,
      args: [wethAddress],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['StableSwapDispatcher'];
