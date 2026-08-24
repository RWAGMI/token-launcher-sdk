import { describe, expect, it } from 'vitest'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_WETH,
  DEFAULT_LAUNCHER_ADDRESSES,
  launchDraftToCreateAssetInput,
  legacyWethLaunchPair,
  type LaunchDraft,
} from '../src/index.js'
import type { Address, Hex } from 'viem'

const CREATOR = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as Address

describe('legacyWethLaunchPair', () => {
  it('binds canonical WETH to the chain’s legacy auction module', () => {
    for (const chainId of [BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID] as const) {
      const pair = legacyWethLaunchPair(chainId)

      expect(pair).not.toBeNull()
      expect(pair!.chainId).toBe(chainId)
      expect(pair!.token.toLowerCase()).toBe(BASE_WETH.toLowerCase())
      expect(pair!.decimals).toBe(18)
      expect(pair!.supportsEthDevBuy).toBe(true)
      expect(pair!.riskLabel).toBe('canonical-weth')
      expect(pair!.mevModule).toBe(DEFAULT_LAUNCHER_ADDRESSES[chainId].mevModule)
    }
  })

  it('returns null for unsupported chains', () => {
    expect(legacyWethLaunchPair(1)).toBeNull()
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
