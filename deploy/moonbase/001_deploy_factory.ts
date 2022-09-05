import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const factory = await getOrNull('Factory')

  if (factory) {
    log(`reusing "Factory" at ${factory.address}`)
  } else {
    await deploy('Factory', {
      from: deployer,
      args: [deployer],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['Factory'];
