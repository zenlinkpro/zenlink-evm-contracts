import { mine, time } from "@nomicfoundation/hardhat-network-helpers"
import { ethers } from "hardhat"

export async function forceAdvanceOneBlock(): Promise<any> {
  return mine()
}

export async function forceAdvanceBlocks(blocks: number): Promise<number> {
  await mine(blocks)
  const block = await ethers.provider.getBlock("latest")
  return block.number
}

export async function forceAdvanceBlocksTo(targetBlock: number): Promise<any>  {
  let currentBlock = await getCurrentBlock()
  
  if (targetBlock < currentBlock) {
    throw Error(`Target block #(${targetBlock}) is lower than current block #(${currentBlock})`)
  }
  while (currentBlock++ < targetBlock) {
    await forceAdvanceOneBlock()
  }
}

export async function setTimestamp(timestamp: number): Promise<any> {
  await time.increaseTo(timestamp)
}

export async function increaseTimestamp(timestampDelta: number): Promise<number> {
  return time.increase(timestampDelta)
}

export async function setNextTimestamp(timestamp: number): Promise<any> {
  return time.setNextBlockTimestamp(timestamp)
}

export async function getCurrentBlock(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.number
}

export async function getCurrentBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest")
  return block.timestamp
}
