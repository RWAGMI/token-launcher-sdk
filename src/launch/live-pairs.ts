import { getAddress, type Address } from 'viem'
import type { LaunchPairConfig } from './pairs.js'

/**
 * What the launcher currently says about one curated pair.
 *
 * Both gates are read from `RwagmiB20Launcher`: a launch reverts with
 * `MevModuleNotEnabled` or `PairedTokenNotEnabled` if either is false, so a
 * pair is only genuinely launchable when both are true.
 */
export interface LaunchPairChainState {
  /** `launcher.mevModuleEnabled(pair.mevModule)` */
  moduleEnabled: boolean
  /** `launcher.pairedTokenEnabled(pair.token)` */
  pairEnabled: boolean
}

/**
 * The pre-v2.1 unbound auction module, and whether the launcher still accepts
 * it. Supplied so WETH keeps launching through the old module during the
 * cutover window, rather than your app going dark between shipping a build and
 * the on-chain enablement landing.
 */
export interface LegacyMevModule {
  address: Address
  enabled: boolean
}

/** Key a pair's chain state by its paired token. */
export function launchPairStateKey(token: string): string {
  return token.toLowerCase()
}

/**
 * Narrow the build-time pair list to what the launcher will actually accept
 * right now, substituting the legacy module for WETH where that is the only
 * live option.
 *
 * ## Why this reads chain state at all
 *
 * The pair list is otherwise pure build-time config, which makes enablement a
 * two-part operation that has to be sequenced by hand: ship a build pointing at
 * the v2.1 modules, then enable them on the launcher, and launching is broken
 * in between — in EITHER order, because the old build points at a module that
 * is about to be disabled and the new one points at modules not yet enabled.
 *
 * Reading the launcher removes the sequencing entirely. Deploy whenever; your
 * app serves whatever is live, and follows the on-chain change within a block.
 *
 * ## The three cases
 *
 * - Both gates true — offer the pair with its own pair-bound module.
 * - WETH with its v2.1 module still dark, but the legacy module live — offer
 *   WETH through the legacy module. This is the cutover window, and it is
 *   deliberately WETH-only: the legacy module is unbound and accepts any pair,
 *   so extending this to a stock is exactly the cross-product hole v2.1 closes.
 * - Anything else — withhold it. A pair the launcher will reject should not be
 *   selectable.
 *
 * `state` of null means "not known yet" — still loading, or the read failed. In
 * that case the build-time list is returned unchanged, so an RPC blip degrades
 * to today's behaviour rather than emptying the launch form. A launch prepared
 * against a stale list still simulates before signing, so the user gets a
 * decoded revert rather than a burned transaction.
 */
export function selectLiveLaunchPairs(
  pairs: readonly LaunchPairConfig[],
  state: ReadonlyMap<string, LaunchPairChainState> | null,
  legacy: LegacyMevModule | null,
): LaunchPairConfig[] {
  if (state === null) return [...pairs]

  const live: LaunchPairConfig[] = []
  for (const pair of pairs) {
    const status = state.get(launchPairStateKey(pair.token))
    if (!status) continue
    if (status.moduleEnabled && status.pairEnabled) {
      live.push(pair)
      continue
    }
    // The cutover fallback. `supportsEthDevBuy` is true only for canonical
    // WETH, which is what keeps this off every stock pair.
    if (
      pair.supportsEthDevBuy &&
      status.pairEnabled &&
      legacy?.enabled &&
      legacy.address
    ) {
      live.push({ ...pair, mevModule: getAddress(legacy.address) })
    }
  }

  // Same rule the build-time resolver applies: every product default is
  // written for WETH, so a list without it is a misconfiguration rather than a
  // stock-only offering. Disable launching instead of serving it.
  if (!live.some((p) => p.supportsEthDevBuy)) return []
  return live
}
