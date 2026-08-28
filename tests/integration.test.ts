import { describe, expect, it } from 'vitest'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_WETH,
  DEFAULT_LAUNCH_PAIR_MODULES,
  defaultWethLaunchPair,
  launchDraftToCreateAssetInput,
  launchPairKey,
  legacyWethLaunchPair,
  type LaunchDraft,
} from '../src/index.js'
import type { Address, Hex } from 'viem'

const CREATOR = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as Address

describe('defaultWethLaunchPair', () => {
  it('binds canonical WETH to its deployed pair-bound module', () => {
    const pair = defaultWethLaunchPair(BASE_MAINNET_CHAIN_ID)

    expect(pair).not.toBeNull()
    expect(pair!.chainId).toBe(BASE_MAINNET_CHAIN_ID)
    expect(pair!.token.toLowerCase()).toBe(BASE_WETH.toLowerCase())
    expect(pair!.decimals).toBe(18)
    expect(pair!.supportsEthDevBuy).toBe(true)
    expect(pair!.riskLabel).toBe('canonical-weth')
    expect(pair!.mevModule.toLowerCase()).toBe(
      DEFAULT_LAUNCH_PAIR_MODULES[
        launchPairKey(BASE_MAINNET_CHAIN_ID, BASE_WETH)
      ]!.toLowerCase(),
    )
  })

  it('returns null where no module is deployed, rather than a reverting pair', () => {
    // Base Sepolia's unbound module was disabled by the cutover and has no
    // pair-bound replacement, so there is nothing launchable to return.
    expect(defaultWethLaunchPair(BASE_SEPOLIA_CHAIN_ID)).toBeNull()
    expect(defaultWethLaunchPair(1)).toBeNull()
  })
})

describe('legacyWethLaunchPair', () => {
  it('is inert: the module it named is no longer allowlisted', () => {
    expect(legacyWethLaunchPair(BASE_MAINNET_CHAIN_ID)).toBeNull()
    expect(legacyWethLaunchPair(BASE_SEPOLIA_CHAIN_ID)).toBeNull()
  })
})

describe('launchDraftToCreateAssetInput', () => {
  it('carries only the B20 create params across', () => {
    const draft: LaunchDraft = {
      variant: 'asset',
      name: 'RWAGMI Token',
      symbol: 'RWG',
      decimals: 18,
      salt: ('0x' + '11'.repeat(32)) as Hex,
      poolSupply: 1_000_000n * 10n ** 18n,
      creatorRecipient: CREATOR,
      creatorAdmin: CREATOR,
      pairedToken: BASE_WETH,
      initialPrice: 1,
      initialAdmin: CREATOR,
    }

    expect(launchDraftToCreateAssetInput(draft)).toEqual({
      variant: 'asset',
      name: 'RWAGMI Token',
      symbol: 'RWG',
      initialAdmin: CREATOR,
      decimals: 18,
    })
  })
})
