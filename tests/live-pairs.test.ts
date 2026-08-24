import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import {
  BASE_MAINNET_CHAIN_ID,
  launchPairStateKey,
  selectLiveLaunchPairs,
  type LaunchPairChainState,
  type LaunchPairConfig,
} from '../src/index.js'

const WETH = getAddress('0x4200000000000000000000000000000000000006')
const GOOGLC = getAddress('0xb2000000000000000000002d0ba3164cc74f58b7')
const WETH_V1 = getAddress('0x72BD22136b321ea321573828E00120B016CE3967')
const GOOGLC_V1 = getAddress('0xe6A1f39b642Fb27BF400D10428135551e1dd5fa4')
const LEGACY_V0 = getAddress('0x95719146a4E01E5cF77E9bC9fA9404B0Bb079232')

const pair = (
  token: string,
  mevModule: string,
  supportsEthDevBuy: boolean,
  symbol: string,
): LaunchPairConfig => ({
  chainId: BASE_MAINNET_CHAIN_ID,
  token: getAddress(token),
  name: symbol,
  symbol,
  decimals: supportsEthDevBuy ? 18 : 8,
  defaultOpeningPrice: '0.000000000025',
  mevModule: getAddress(mevModule),
  supportsEthDevBuy,
  riskLabel: supportsEthDevBuy ? 'canonical-weth' : 'admin-controlled-b20-stock',
})

const PAIRS = [pair(WETH, WETH_V1, true, 'WETH'), pair(GOOGLC, GOOGLC_V1, false, 'GOOGLc')]

const state = (
  entries: Record<string, LaunchPairChainState>,
): Map<string, LaunchPairChainState> =>
  new Map(Object.entries(entries).map(([k, v]) => [launchPairStateKey(k), v]))

const live = { moduleEnabled: true, pairEnabled: true }
const dark = { moduleEnabled: false, pairEnabled: false }

describe('live pair selection', () => {
  it('serves the build-time list unchanged while chain state is unknown', () => {
    // Loading, or the read failed. Degrading to today's behaviour beats
    // emptying the launch form on an RPC blip; the launch still simulates
    // before signing, so a stale entry surfaces as a decoded revert.
    expect(selectLiveLaunchPairs(PAIRS, null, null)).toEqual([...PAIRS])
  })

  it('offers both pairs once the Safe has enabled everything', () => {
    const result = selectLiveLaunchPairs(
      PAIRS,
      state({ [WETH]: live, [GOOGLC]: live }),
      { address: LEGACY_V0, enabled: false },
    )
    expect(result.map((p) => p.symbol)).toEqual(['WETH', 'GOOGLc'])
    // Each keeps its OWN pair-bound module; nothing is substituted.
    expect(result[0]!.mevModule).toBe(WETH_V1)
    expect(result[1]!.mevModule).toBe(GOOGLC_V1)
  })

  it('keeps WETH launching through the legacy module during the cutover', () => {
    // Build deployed, enablement not executed yet: the v2.1 modules are
    // dark and the legacy one is still live. This is the window that would
    // otherwise take launching down.
    const result = selectLiveLaunchPairs(
      PAIRS,
      state({
        [WETH]: { moduleEnabled: false, pairEnabled: true },
        [GOOGLC]: dark,
      }),
      { address: LEGACY_V0, enabled: true },
    )
    expect(result.map((p) => p.symbol)).toEqual(['WETH'])
    expect(result[0]!.mevModule).toBe(LEGACY_V0)
  })

  it('never substitutes the legacy module for a stock pair', () => {
    // The legacy module is UNBOUND — it accepts any pair. Offering it for a
    // stock is precisely the cross-product hole v2.1 exists to close.
    const result = selectLiveLaunchPairs(
      PAIRS,
      state({
        [WETH]: live,
        [GOOGLC]: { moduleEnabled: false, pairEnabled: true },
      }),
      { address: LEGACY_V0, enabled: true },
    )
    expect(result.map((p) => p.symbol)).toEqual(['WETH'])
    expect(result[0]!.mevModule).toBe(WETH_V1)
  })

  it('withholds a pair the launcher would reject', () => {
    for (const bad of [
      { moduleEnabled: true, pairEnabled: false },
      { moduleEnabled: false, pairEnabled: true },
      dark,
    ]) {
      const result = selectLiveLaunchPairs(
        PAIRS,
        state({ [WETH]: live, [GOOGLC]: bad }),
        null,
      )
      expect(result.map((p) => p.symbol)).toEqual(['WETH'])
    }
  })

  it('drops stock pairs the moment the Safe disables them, with no redeploy', () => {
    // Rollback tier 1: `setPairedToken(stock, false)`. The build still carries
    // the module env var, so a build-time list would keep showing GOOGLc.
    const result = selectLiveLaunchPairs(
      PAIRS,
      state({ [WETH]: live, [GOOGLC]: { moduleEnabled: true, pairEnabled: false } }),
      null,
    )
    expect(result.map((p) => p.symbol)).toEqual(['WETH'])
  })

  it('disables launching entirely rather than serving a stock-only list', () => {
    // Every product default — opening price, preview copy, dev-buy affordance —
    // is written for WETH. A list without it is a misconfiguration.
    const result = selectLiveLaunchPairs(
      PAIRS,
      state({ [WETH]: dark, [GOOGLC]: live }),
      { address: LEGACY_V0, enabled: false },
    )
    expect(result).toEqual([])
  })

  it('does not invent state for a pair the reads did not cover', () => {
    expect(selectLiveLaunchPairs(PAIRS, state({}), null)).toEqual([])
  })
})

/**
 * The real cutover, using the addresses actually deployed to Base mainnet on
 * 2026-08-24 and the two chain states observed on a fork either side of the
 * enablement batch. This is the behaviour the frontend deploy depends on.
 */
describe('the deployed v2.1 cutover', () => {
  const MODULES: Record<string, string> = {
    WETH: '0x72BD22136b321ea321573828E00120B016CE3967',
    GOOGLc: '0xe6A1f39b642Fb27BF400D10428135551e1dd5fa4',
    AAPLc: '0x5f1e5e728CEA9296a65e69AAf1246414708d3712',
    NVDAc: '0xC52b2a85B28736E9550EFF553c95fC3D5595978E',
    METAc: '0x5db77e41fD36236559608110d90fFA926A24d424',
  }
  const TOKENS: Record<string, string> = {
    WETH: '0x4200000000000000000000000000000000000006',
    GOOGLc: '0xb2000000000000000000002D0BA3164cc74f58B7',
    AAPLc: '0xb200000000000000000000C2e324d24d7eEcd1fb',
    NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
    METAc: '0xb2000000000000000000008bC8786B856E61707C',
  }
  const deployed = Object.keys(MODULES).map((sym) =>
    pair(TOKENS[sym]!, MODULES[sym]!, sym === 'WETH', sym),
  )

  it('serves WETH through the legacy module before enablement lands', () => {
    // Observed on a mainnet fork: legacy V0 live, every v2.1 module dark,
    // WETH's pair already enabled from the v2 era, no stock pair enabled.
    const observed = state({
      [TOKENS.WETH!]: { moduleEnabled: false, pairEnabled: true },
      [TOKENS.GOOGLc!]: dark,
      [TOKENS.AAPLc!]: dark,
      [TOKENS.NVDAc!]: dark,
      [TOKENS.METAc!]: dark,
    })
    const result = selectLiveLaunchPairs(deployed, observed, {
      address: LEGACY_V0,
      enabled: true,
    })
    expect(result.map((p) => p.symbol)).toEqual(['WETH'])
    expect(result[0]!.mevModule).toBe(LEGACY_V0)
  })

  it('serves every pair on its own module once enablement lands', () => {
    // Same fork, after executing enablement.json as the owner Safe.
    const observed = state(
      Object.fromEntries(Object.values(TOKENS).map((t) => [t, live])),
    )
    const result = selectLiveLaunchPairs(deployed, observed, {
      address: LEGACY_V0,
      enabled: false,
    })
    expect(result.map((p) => p.symbol)).toEqual([
      'WETH',
      'GOOGLc',
      'AAPLc',
      'NVDAc',
      'METAc',
    ])
    for (const p of result) {
      expect(p.mevModule).toBe(getAddress(MODULES[p.symbol]!))
    }
  })
})
