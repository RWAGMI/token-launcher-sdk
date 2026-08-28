import {
  BASE_MAINNET_CHAIN_ID,
  DEFAULT_LAUNCHER_ADDRESSES,
  DEFAULT_RWAGMI_FEE_CONFIG,
  defaultWethLaunchPair,
  parseLaunchReceipt,
  prepareRwagmiLaunch,
  randomSalt,
  toWriteContractArgs,
} from '@rwagmi/token-launcher-sdk'
import { createPublicClient, http, parseUnits, type Address } from 'viem'
import { base } from 'viem/chains'

/**
 * Framework-neutral launch preparation example.
 *
 * In a Next + wagmi app, call this from your launch submit handler, render the
 * returned plan for review, then pass `toWriteContractArgs(plan)` to wagmi's
 * writeContract after the user confirms.
 */
export async function prepareExampleLaunch(creator: Address) {
  const chainId = BASE_MAINNET_CHAIN_ID
  const addresses = DEFAULT_LAUNCHER_ADDRESSES[chainId]

  // In production, offer `defaultLaunchPairs(chainId)` and let the user pick
  // one — or `resolveLaunchPairs(chainId, modules)` against your own
  // deployment. This is the canonical WETH pair and its bound auction module.
  const pair = defaultWethLaunchPair(chainId)
  if (!pair) throw new Error('no launch pair configured for this chain')

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  })

  const prepared = await prepareRwagmiLaunch({
    client: publicClient,
    chainId,
    addresses,
    rwagmiFee: DEFAULT_RWAGMI_FEE_CONFIG[chainId],
    pair,
    draft: {
      variant: 'asset',
      name: 'Example Token',
      symbol: 'EXAMP',
      decimals: 18,
      salt: randomSalt(),
      poolSupply: parseUnits('1000000', 18),
      creatorRecipient: creator,
      creatorAdmin: creator,
      // The pair is authoritative; the draft must agree with it.
      pairedToken: pair.token,
      lpFee: 10_000,
      initialPrice: 0.000001,
      initialAdmin: creator,
      adminMode: 'immutable',
      liquidityShape: 'Standard',
    },
  })

  return {
    predictedToken: prepared.predictedToken,
    review: prepared.plan,
    writeContractArgs: toWriteContractArgs(prepared.plan),
  }
}

export async function readLaunchResult(
  hash: `0x${string}`,
  publicClient: ReturnType<typeof createPublicClient>,
) {
  const chainId = BASE_MAINNET_CHAIN_ID
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return parseLaunchReceipt(receipt, DEFAULT_LAUNCHER_ADDRESSES[chainId].launcher)
}
