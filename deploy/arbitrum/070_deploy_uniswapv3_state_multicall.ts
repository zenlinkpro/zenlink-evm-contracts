import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull, log } = deployments
  const { deployer } = await getNamedAccounts()

  const uniswapV3StateMulticall = await getOrNull('UniswapV3StateMulticall')

  if (uniswapV3StateMulticall) {
    log(`reusing "uniswapV3StateMulticall" at ${uniswapV3StateMulticall.address}`)
  } else {
    await deploy('UniswapV3StateMulticall', {
      from: deployer,
      args: [],
      log: true,
      skipIfAlreadyDeployed: true
    })
  }
}
export default func;
func.tags = ['UniswapV3StateMulticall'];
