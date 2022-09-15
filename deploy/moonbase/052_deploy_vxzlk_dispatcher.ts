import { BigNumber } from "ethers";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, get, execute } = deployments
  const { deployer } = await getNamedAccounts()

  const vxZLKDispatcher = await getOrNull('vxZLKDispatcher')
  const vxZLK = await getOrNull('vxZenlinkToken')
  const zlk = await getOrNull('ZenlinkToken')

  if (vxZLKDispatcher) {
    log(`reusing "vxZLKDispatcher" at ${vxZLKDispatcher.address}`)
    await execute(
      'vxZLKDispatcher',
      { from: deployer, log: true },
      'dispatchReward'
    )
  } else {
    if (zlk && vxZLK) {
      await deploy('vxZLKDispatcher', {
        from: deployer,
        log: true,
        contract: 'RewardDispatcher',
        args: [zlk.address, vxZLK.address],
        skipIfAlreadyDeployed: true
      })

      const deployedDispatcher = await get('vxZLKDispatcher')

      await execute(
        'ZenlinkToken',
        { from: deployer, log: true },
        'transfer',
        deployedDispatcher.address,
        BigNumber.from(10).pow(18).mul(50000)
      )

      await execute(
        'vxZLKDispatcher',
        { from: deployer, log: true },
        'updateRate',
        BigNumber.from(10).pow(17)
      )
    }
  }
}
export default func;
func.tags = ['vxZLKDispatcher'];
