import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get } = deployments
  const { deployer, libraryDeployer } = await getNamedAccounts()

  const zenlinkMaker = await getOrNull('ZenlinkMaker')
  const wnative = '0x674421E9567653EE76e96fEEA3B2B2966d000Dbd'

  if (zenlinkMaker) {
    log(`reusing "ZenlinkMaker" at ${zenlinkMaker.address}`)
  } else {
    await deploy('ZenlinkMaker', {
      from: deployer,
      log: true,
      args: [
        (await get('Factory')).address,
        (await get('vxZenlinkToken')).address,
        (await get('ZenlinkToken')).address,
        wnative,
        libraryDeployer
      ],
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['ZenlinkMaker'];
