export const CHAIN_ID: Record<string, string> = {
  ASTAR: '592',
  MOONBASE: '1287',
  ARBITRUM: '42161'
}

export function isTestNetwork(networkId: string): boolean {
  return (
    networkId === CHAIN_ID.MOONBASE
  )
}
