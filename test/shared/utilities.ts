import { Bytes, Contract, Signer, utils } from 'ethers'
import { BigNumber } from '@ethersproject/bignumber'
import { MockProvider } from 'ethereum-waffle'
import { Artifact } from 'hardhat/types'
import { ethers } from "hardhat"

export const MAX_UINT256 = ethers.constants.MaxUint256
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export enum TIME {
  SECONDS = 1,
  DAYS = 86400,
  WEEKS = 604800,
}

export const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function expandTo10Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(10))
}

export async function getCurrentBlockTimestamp(provider: MockProvider): Promise<number> {
  const block = await provider.getBlock("latest")
  return block.timestamp
}

export async function forceAdvanceOneBlock(provider: MockProvider, timestamp?: number): Promise<any> {
  const params = timestamp ? [timestamp] : []
  return provider.send("evm_mine", params)
}

export async function setTimestamp(provider: MockProvider, timestamp: number): Promise<any> {
  return forceAdvanceOneBlock(provider, timestamp)
}

export async function setNextTimestamp(provider: MockProvider, timestamp: number): Promise<any> {
  return setTimestamp(provider, timestamp)
}

export async function getUserTokenBalances(
  address: string | Signer,
  tokens: Contract[],
): Promise<BigNumber[]> {
  const balanceArray = []

  if (address instanceof Signer) {
    address = await address.getAddress()
  }

  for (const token of tokens) {
    balanceArray.push(await token.balanceOf(address))
  }

  return balanceArray
}

export async function getUserTokenBalance(
  address: string | Signer,
  token: Contract,
): Promise<BigNumber> {
  if (address instanceof Signer) {
    address = await address.getAddress()
  }
  return token.balanceOf(address)
}

export function getDomainSeparator(name: string, tokenAddress: string) {
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

export async function mineBlockWithTimestamp(provider: MockProvider, timestamp: number): Promise<void> {
  await provider.send('evm_setNextBlockTimestamp', [timestamp]);
  await provider.send('evm_mine', []);
}

export async function asyncForEach<T>(
  array: Array<T>,
  callback: (item: T, index: number) => void,
): Promise<void> {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index)
  }
}

export function linkBytecode(
  artifact: Artifact,
  libraries: Record<string, string>,
): string | Bytes {
  let bytecode = artifact.bytecode

  for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
    for (const [libName, fixups] of Object.entries(fileReferences)) {
      const addr = libraries[libName]
      if (addr === undefined) {
        continue
      }

      for (const fixup of fixups) {
        bytecode =
          bytecode.substring(0, 2 + fixup.start * 2) +
          addr.substring(2) +
          bytecode.substring(2 + (fixup.start + fixup.length) * 2)
      }
    }
  }

  return bytecode
}
