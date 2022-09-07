import { BigNumber } from "ethers";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get, execute } = deployments
  const { deployer } = await getNamedAccounts()

  const zlkLoyaltyCalculator = await getOrNull('ZenlinkTokenLoyaltyCalculator')

  if (zlkLoyaltyCalculator) {
    log(`reusing "ZenlinkTokenLoyaltyCalculator" at ${zlkLoyaltyCalculator.address}`)
  } else {
    await deploy('ZenlinkTokenLoyaltyCalculator', {
      from: deployer,
      log: true,
      args: [
        (await get('vxZenlinkToken')).address,
        (await get('ZenlinkToken')).address,
        BigNumber.from(0), // min: 0%
        BigNumber.from(10).pow(17).mul(5) // max: 50%
      ],
      skipIfAlreadyDeployed: true
    })

    // update zenlinkTokenLoyaltyCalculator address
    await execute(
      "vxZenlinkToken",
      { from: deployer, log: true },
      "updateLoyaltyCaculator",
      (await get('ZenlinkTokenLoyaltyCalculator')).address
    )
  }
}
export default func;
func.tags = ['ZenlinkTokenLoyaltyCalculator'];
