import { DeployFunction } from "hardhat-deploy/types"
import { HardhatRuntimeEnvironment } from "hardhat/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { execute, get, getOrNull, log, read, deploy } = deployments
  const { deployer } = await getNamedAccounts()

  // Manually check if the pool is already deployed
  const moonbase4Pool = await getOrNull("Moonbase4Pool")
  if (moonbase4Pool) {
    log(`reusing "Moonbase4Pool" at ${moonbase4Pool.address}`)
  } else {
    // Constructor arguments
    const TOKEN_ADDRESSES = [
      (await get("DAI")).address,
      (await get("USDC")).address,
      (await get("USDT")).address,
      (await get("FRAX")).address,
    ]
    const TOKEN_DECIMALS = [18, 6, 6, 18]
    const LP_TOKEN_NAME = "Zenlink 4pool"
    const LP_TOKEN_SYMBOL = "4pool"
    const INITIAL_A = 200
    const SWAP_FEE = 5e6 // 4bps
    const ADMIN_FEE = 5e9 // 50%

    await deploy('Moonbase4Pool', {
      from: deployer,
      log: true,
      contract: 'StableSwap',
      libraries: {
        StableSwapStorage: (await get('StableSwapStorage')).address
      },
      skipIfAlreadyDeployed: true
    })

    await execute(
      "Moonbase4Pool",
      { from: deployer, log: true },
      "initialize",
      TOKEN_ADDRESSES,
      TOKEN_DECIMALS,
      LP_TOKEN_NAME,
      LP_TOKEN_SYMBOL,
      INITIAL_A,
      SWAP_FEE,
      ADMIN_FEE,
      deployer
    )

    const lpTokenAddress = (await read("Moonbase4Pool", "swapStorage"))
      .lpToken
    log(`Zenlink 4Pool LP Token at ${lpTokenAddress}`)
  }
}
export default func
func.tags = ["Moonbase4Pool"]
func.dependencies = ["StableSwapStorage", "Moonbase4PoolTokens"]
