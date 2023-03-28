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
    const wastrAddress = '0xAeaaf0e2c81Af264101B9129C00F4440cCF0F720'
    await deploy('StableSwapDispatcher', {
      from: deployer,
      args: [wastrAddress],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['StableSwapDispatcher'];
