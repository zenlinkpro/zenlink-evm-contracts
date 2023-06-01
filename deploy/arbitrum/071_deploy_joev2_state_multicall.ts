import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const joeV2StateMulticall = await getOrNull('JoeV2StateMulticall')

  if (joeV2StateMulticall) {
    log(`reusing "joeV2StateMulticall" at ${joeV2StateMulticall.address}`)
  } else {
    await deploy('JoeV2StateMulticall', {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['JoeV2StateMulticall'];
