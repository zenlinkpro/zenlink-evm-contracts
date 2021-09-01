import { MockProvider } from 'ethereum-waffle'

type TimeSetterFunction = (timestamp: number) => Promise<void>

type TimeSetters = {
  set: TimeSetterFunction
  step: TimeSetterFunction
  setAndMine: TimeSetterFunction
  advanceBlockTo: TimeSetterFunction
}

export const createTimeMachine = (provider: MockProvider): TimeSetters => {
  return {
    set: async (timestamp: number) => {
      await provider.send('evm_setNextBlockTimestamp', [timestamp])
    },

    step: async (interval: number) => {
      await provider.send('evm_increaseTime', [interval])
    },

    setAndMine: async (timestamp: number) => {
      await provider.send('evm_setNextBlockTimestamp', [timestamp])
      await provider.send('evm_mine', [])
    },

    advanceBlockTo: async (targetBlock: number) => {
      let currentBlock = (await provider.getBlock('latest')).number;
      
      if (targetBlock < currentBlock) {
        throw Error(`Target block #(${targetBlock}) is lower than current block #(${currentBlock})`)
      }
      while (currentBlock++ < targetBlock) {
        await provider.send('evm_mine', [])
      }
    }
  }
}