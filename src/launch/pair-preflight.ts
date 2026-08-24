import type { Hex } from 'viem'
import type { LaunchPairConfig } from './pairs.js'

/**
 * Outcome of the paired-token preflight.
 *
 * `no-bytecode` is the only failure because it is the only one that is both
 * silent and permanent: see `evaluatePairPreflight`.
 */
export type PairPreflightStatus = 'ok' | 'no-bytecode'

export interface PairPreflightResult {
  status: PairPreflightStatus
  /** User-facing reason, or null when the pair is usable. */
  reason: string | null
}

const OK: PairPreflightResult = { status: 'ok', reason: null }

/**
 * Decide whether a curated pair is safe to launch against, given the paired
 * token's deployed bytecode.
 *
 * ## Why bytecode, of all things
 *
 * Base's tokenized stocks are native precompiles, and Base's own integration
 * guide describes them as holding *no bytecode*. That is not what the chain
 * reports today — every curated stock returns a single `0xef` byte — and the
 * difference is load-bearing rather than cosmetic.
 *
 * The locker pays LP fees out with OpenZeppelin's `SafeERC20`, whose
 * `Address.functionCall` reverts `AddressEmptyCode` when the target has
 * `code.length == 0` and the call returns no data. A genuinely code-less
 * precompile would therefore be launchable and tradeable but **unclaimable**:
 * fees would accrue into a pool whose stock side could never be withdrawn, and
 * because `collectRewards` takes both currencies in one atomic pair, the
 * healthy launch-token side would be stuck with it. Nothing about that failure
 * is visible at launch time, and the locker is already deployed, so it cannot
 * be patched after the fact.
 *
 * One byte is all that separates the two worlds, so we check for it rather than
 * trusting either the docs or today's behaviour to hold. RWAGMI proves the same
 * invariant against the real precompiles in a Base mainnet fork test; this is
 * that guard at the point where a user is about to spend money.
 *
 * @param bytecode The token's deployed code, as returned by `eth_getCode`.
 *                 `undefined` or `'0x'` both mean "no code". Only call this
 *                 once the read has actually succeeded — an unresolved read is
 *                 not evidence of an empty account, and must not block a
 *                 launch.
 */
export function evaluatePairPreflight(
  pair: Pick<LaunchPairConfig, 'symbol'>,
  bytecode: Hex | undefined,
): PairPreflightResult {
  if (bytecode === undefined || bytecode === '0x') {
    return {
      status: 'no-bytecode',
      reason:
        `${pair.symbol} has no contract code at its address. Launching against it ` +
        `would create a pool whose ${pair.symbol} LP fees can never be claimed. ` +
        `Pick another pair.`,
    }
  }
  return OK
}
