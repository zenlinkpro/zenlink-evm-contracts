import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const zlkDiscountReader = await getOrNull('ZLKDiscountReader')

  if (zlkDiscountReader) {
    log(`reusing "ZLKDiscountReader" at ${zlkDiscountReader.address}`)
  } else {
    const zlkAddress = '0x998082c488e548820f970df5173bd2061ce90635'
    await deploy('ZLKDiscountReader', {
      from: deployer,
      args: [zlkAddress],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['ZLKDiscountReader'];
