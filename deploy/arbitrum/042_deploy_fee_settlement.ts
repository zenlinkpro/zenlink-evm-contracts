import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const feeSettlement = await getOrNull('FeeSettlement')

  if (feeSettlement) {
    log(`reusing "FeeSettlement" at ${feeSettlement.address}`)
  } else {
    const wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    const referral = await getOrNull('ReferralStorage')
    if (!referral) {
      log('No deployed "ReferralStorage" found')
      return
    }
    await deploy('FeeSettlement', {
      from: deployer,
      args: [
        wethAddress,
        referral.address,
        10, // 0.1% fee
        2000, // 20% discount
        2500, // 25% rebate
        deployer
      ],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['FeeSettlement'];
