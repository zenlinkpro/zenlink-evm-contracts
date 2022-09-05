import { BigNumber } from "ethers";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log, execute } = deployments
  const { deployer } = await getNamedAccounts()

  const zenlinkToken = await getOrNull('ZenlinkToken')

  if (zenlinkToken) {
    log(`reusing "ZenlinkToken" at ${zenlinkToken.address}`)
  } else {
    await deploy('ZenlinkToken', {
      from: deployer,
      log: true,
      args: [
        'Zenlink Network Token',
        'ZLK',
        '18',
        BigNumber.from(10).pow(18).mul(1000000),
        BigNumber.from(10).pow(18).mul(1e9)
      ],
      skipIfAlreadyDeployed: true
    })

    // enable transfer
    await execute(
      'ZenlinkToken',
      { from: deployer, log: true },
      "enableTransfer"
    )
  }
}
export default func;
func.tags = ['ZenlinkToken'];
