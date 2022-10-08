import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Factory } from "../../types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, getOrNull, log, get, execute } = deployments
  const { getContractAt } = ethers
  const { deployer, libraryDeployer } = await getNamedAccounts()

  const zenlinkMaker = await getOrNull('ZenlinkMaker')
  const wnative = '0x674421E9567653EE76e96fEEA3B2B2966d000Dbd'

  if (zenlinkMaker) {
    log(`reusing "ZenlinkMaker" at ${zenlinkMaker.address}`)
    const factory = await getOrNull('Factory')
    if (factory) {
      const factoryContract = (await getContractAt('Factory', factory.address)) as Factory
      const feeToAddress = await factoryContract.feeto()
      if (feeToAddress !== zenlinkMaker.address) {
        await execute(
          'Factory',
          { from: deployer, log: true },
          'setFeeto',
          zenlinkMaker.address
        )
      }
    }
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
