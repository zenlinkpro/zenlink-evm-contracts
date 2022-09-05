import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get } = deployments
  const { deployer } = await getNamedAccounts()

  const swapRouterV1 = await getOrNull('SwapRouterV1')
  const wnative = '0x674421E9567653EE76e96fEEA3B2B2966d000Dbd'

  if (swapRouterV1) {
    log(`reusing "SwapRouterV1" at ${swapRouterV1.address}`)
  } else {
    await deploy('SwapRouterV1', {
      from: deployer,
      args: [(await get('Factory')).address, wnative],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['SwapRouterV1'];
