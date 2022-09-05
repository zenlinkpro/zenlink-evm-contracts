import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const farming = await getOrNull('Farming')

  if (farming) {
    log(`reusing "Farming" at ${farming.address}`)
  } else {
    await deploy('Farming', {
      from: deployer,
      log: true,
      args: [],
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['Farming'];
