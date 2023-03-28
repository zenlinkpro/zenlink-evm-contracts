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
    const wastrAddress = '0xAeaaf0e2c81Af264101B9129C00F4440cCF0F720'
    const referral = await getOrNull('ReferralStorage')
    if (!referral) {
      log('No deployed "ReferralStorage" found')
      return
    }
    await deploy('FeeSettlement', {
      from: deployer,
      args: [
        wastrAddress,
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
