import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const universalRouter = await getOrNull('UniversalRouter')

  if (universalRouter) {
    log(`reusing "UniversalRouter" at ${universalRouter.address}`)
  } else {
    const stableSwapDispatcher = await getOrNull('StableSwapDispatcher')
    const feeSettlement = await getOrNull('FeeSettlement')
    if (!stableSwapDispatcher || !feeSettlement) {
      log('Missing deployed "StableSwapDispatcher" or "FeeSettlement"')
      return
    }
    await deploy('UniversalRouter', {
      from: deployer,
      args: [
        stableSwapDispatcher.address,
        feeSettlement.address
      ],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['UniversalRouter'];
