import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get } = deployments
  const { deployer } = await getNamedAccounts()

  const vxZenlinkToken = await getOrNull('vxZenlinkToken')

  if (vxZenlinkToken) {
    log(`reusing "vxZenlinkToken" at ${vxZenlinkToken.address}`)
  } else {
    await deploy('vxZenlinkToken', {
      from: deployer,
      log: true,
      args: [
        (await get('ZenlinkToken')).address,
        'Zenlink Vault Asset',
        'vxZLK'
      ],
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['vxZenlinkToken'];
