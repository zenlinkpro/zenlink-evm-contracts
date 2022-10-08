import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const multicall3 = await getOrNull('Multicall3')

  if (multicall3) {
    log(`reusing "Multicall3" at ${multicall3.address}`)
  } else {
    await deploy('Multicall3', {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['Multicall3'];
