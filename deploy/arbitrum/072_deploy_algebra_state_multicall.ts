import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const algebraStateMulticall = await getOrNull('AlgebraStateMulticall')

  if (algebraStateMulticall) {
    log(`reusing "algebraStateMulticall" at ${algebraStateMulticall.address}`)
  } else {
    await deploy('AlgebraStateMulticall', {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['AlgebraStateMulticall'];
