import { base, baseSepolia } from 'viem/chains'
import type { Chain } from 'viem'

export { base, baseSepolia }

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id // 84532
export const BASE_MAINNET_CHAIN_ID = base.id // 8453

export const SUPPORTED_CHAINS: readonly Chain[] = [baseSepolia, base]
export const SUPPORTED_CHAIN_IDS = SUPPORTED_CHAINS.map((c) => c.id)

export type SupportedChainId =
  | typeof BASE_SEPOLIA_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID

export function isSupportedChainId(id: number): id is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(id)
}

export function getChain(chainId: number): Chain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId)
}

export function chainName(chainId: number): string {
  return getChain(chainId)?.name ?? `Chain ${chainId}`
}

/** Default public RPC for a chain. Browser-facing, so public by nature. */
export function defaultRpcUrl(chainId: number): string | undefined {
  return getChain(chainId)?.rpcUrls.default.http[0]
}

/** Block explorer base URL (BaseScan). */
export function explorerUrl(chainId: number): string | undefined {
  return getChain(chainId)?.blockExplorers?.default.url
}

export function explorerAddressUrl(
  chainId: number,
  address: string,
): string | undefined {
  const base = explorerUrl(chainId)
  return base ? `${base}/address/${address}` : undefined
}

export function explorerTxUrl(chainId: number, txHash: string): string | undefined {
  const base = explorerUrl(chainId)
  return base ? `${base}/tx/${txHash}` : undefined
}
