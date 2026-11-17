import { erc20Abi, getAddress, type Address } from 'viem'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import { BASE_WETH } from '../../deployments.js'
import { LAUNCH_PAIR_FACTS } from '../pairs.js'
import type { LaunchPairV3, LauncherDeploymentV3 } from './types.js'
import type { ReadClient } from '../../client.js'

/**
 * Enabled paired assets from the supplied candidates, with symbol and decimals
 * read onchain at one block. This does not enumerate the full onchain allowlist.
 *
 * Candidates default to WETH plus every pair in the SDK catalogue for the
 * deployment's chain. Pass your own list to check other tokens, for example
 * addresses from Coinbase's tokenized-stock catalogue. The launcher's
 * `pairedTokenEnabled` allowlist is the source of truth; a token it rejects is
 * left out, and so is any token whose metadata cannot be read, rather than
 * guessing its decimals. Two Multicall3 requests regardless of list size.
 */
export async function readLaunchPairsV3(
  client: ReadClient,
  deployment: LauncherDeploymentV3,
  candidates?: readonly Address[],
): Promise<LaunchPairV3[]> {
  const tokens = [
    ...new Set(
      (
        candidates ?? [
          BASE_WETH,
          ...LAUNCH_PAIR_FACTS.filter((fact) => fact.chainId === deployment.chainId).map(
            (fact) => fact.token,
          ),
        ]
      ).map((token) => getAddress(token)),
    ),
  ]
  if (tokens.length === 0) return []
  const blockNumber = await client.getBlockNumber()
  const enabled = await client.multicall({
    contracts: tokens.map((token) => ({
      address: deployment.launcher,
      abi: rwagmiLauncherV3Abi,
      functionName: 'pairedTokenEnabled' as const,
      args: [token],
    })),
    allowFailure: false,
    blockNumber,
    batchSize: 0,
  })
  const accepted = tokens.filter((_, i) => enabled[i])
  const metadata = await client.multicall({
    contracts: accepted.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: 'decimals' as const },
      { address: token, abi: erc20Abi, functionName: 'symbol' as const },
    ]),
    allowFailure: true,
    blockNumber,
    batchSize: 0,
  })
  const pairs: LaunchPairV3[] = []
  for (const [i, token] of accepted.entries()) {
    const decimals = metadata[2 * i]
    const symbol = metadata[2 * i + 1]
    if (decimals?.status !== 'success' || symbol?.status !== 'success') continue
    pairs.push({
      chainId: deployment.chainId,
      token,
      decimals: Number(decimals.result),
      symbol: String(symbol.result),
      supportsEthDevBuy: token.toLowerCase() === BASE_WETH.toLowerCase(),
    })
  }
  return pairs
}
