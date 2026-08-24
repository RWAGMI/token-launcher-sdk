/**
 * Minimal Chainlink AggregatorV3 surface.
 *
 * Base publishes one feed per tokenized stock. The feeds report **total return**
 * values — the quoted price already has the B20 multiplier folded in — so a
 * price read here lines up with a RAW token balance and needs no multiplier
 * maths. All of them report 8 decimals, but we read `decimals()` rather than
 * assume it: an 8-vs-18 mistake is a 10^10 error, the same class of bug the
 * curated pair decimals exist to prevent.
 *
 * Hand-written, not generated: these are third-party contracts with no artifact
 * in `contracts/out`, so `pnpm contracts:sync` never touches this file.
 */
export const chainlinkAggregatorV3Abi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'description',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const
