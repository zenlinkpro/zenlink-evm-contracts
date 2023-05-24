import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const curveStableDispatcher = await getOrNull('CurveStableDispatcher')

  if (curveStableDispatcher) {
    log(`reusing "CurveStableDispatcher" at ${curveStableDispatcher.address}`)
  } else {
    const wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    await deploy('CurveStableDispatcher', {
      from: deployer,
      args: [wethAddress],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['CurveStableDispatcher'];
