import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const universalRouter2 = await getOrNull('UniversalRouter2')

  if (universalRouter2) {
    log(`reusing "UniversalRouter2" at ${universalRouter2.address}`)
  } else {
    const stableSwapDispatcher = await getOrNull('StableSwapDispatcher')
    const curveStableDispatcher = await getOrNull('CurveStableDispatcher')
    const feeSettlement = await getOrNull('FeeSettlement')
    if (!stableSwapDispatcher || !curveStableDispatcher || !feeSettlement) {
      log('Missing deployed "StableSwapDispatcher" or "FeeSettlement" or "CurveStableDispatcher"')
      return
    }
    await deploy('UniversalRouter2', {
      from: deployer,
      args: [
        stableSwapDispatcher.address,
        curveStableDispatcher.address,
        feeSettlement.address
      ],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['UniversalRouter2'];
