import type { PublicClient } from 'viem'

/**
 * The viem client methods this SDK calls. Any public client satisfies it,
 * including one created with `chain: base`, whose OP-stack formatters make it
 * unassignable to a plain `PublicClient`.
 */
export type ReadClient = Pick<
  PublicClient,
  'readContract' | 'multicall' | 'getBlockNumber' | 'getChainId' | 'simulateContract'
>
