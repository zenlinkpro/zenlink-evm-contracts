import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { libraryDeployer } = await getNamedAccounts()

  const stableSwapStorage = await getOrNull('StableSwapStorage')

  if (stableSwapStorage) {
    log(`reusing "StableSwapStorage" at ${stableSwapStorage.address}`)
  } else {
    await deploy('StableSwapStorage', {
      from: libraryDeployer,
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['StableSwapStorage'];
