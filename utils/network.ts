export const CHAIN_ID: Record<string, string> = {
  MOONBASE: '1287'
}

export function isTestNetwork(networkId: string): boolean {
  return (
    networkId === CHAIN_ID.MOONBASE
  )
}
