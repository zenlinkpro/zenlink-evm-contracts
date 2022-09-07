import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get } = deployments
  const { deployer } = await getNamedAccounts()

  const router = await getOrNull('Router')
  const wnative = '0x674421E9567653EE76e96fEEA3B2B2966d000Dbd'

  if (router) {
    log(`reusing "Router" at ${router.address}`)
  } else {
    await deploy('Router', {
      from: deployer,
      args: [(await get('Factory')).address, wnative],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['Router'];
