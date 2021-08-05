import { utils } from 'ethers'
import { BigNumber } from '@ethersproject/bignumber'


const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

function getDomainSeparator(name: string, tokenAddress: string) {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        utils.keccak256(utils.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        utils.keccak256(utils.toUtf8Bytes(name)),
        utils.keccak256(utils.toUtf8Bytes('1')),
        1,
        tokenAddress
      ]
    )
  )
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string
): string {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]
  const create2Inputs = [
    '0xff',
    factoryAddress,
    utils.keccak256(utils.solidityPack(['address', 'address'], [token0, token1])),
    utils.keccak256(bytecode)
  ]
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}

export async function mineBlockWithTimestamp(provider: any, timestamp: number): Promise<void> {
  await provider.send('evm_setNextBlockTimestamp', [timestamp]);
  await provider.send('evm_mine');
}
