import type { Address } from 'viem'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  type SupportedChainId,
} from './chains.js'
import type { LauncherAddresses, RwagmiFeeConfig } from './launch/addresses.js'
import type { LauncherDeploymentV3 } from './launch/v3/types.js'

export const BASE_WETH = '0x4200000000000000000000000000000000000006' as Address

/**
 * Current public RWAGMI launcher-stack addresses by chain.
 *
 * No default auction module. The v2.1 cutover landed on Base mainnet: the
 * pre-v2.1 unbound module (`0x95719146a4E01E5cF77E9bC9fA9404B0Bb079232` on
 * mainnet, `0x0EBC0FA929BA80cFE4aE417Fb8bDA64870ff6f4C` on Sepolia) is no
 * longer in the launcher's allowlist, so a launch built around it reverts with
 * `MevModuleNotEnabled`. Shipping it as a default was an invitation to do
 * exactly that. The module is per pair — see `DEFAULT_LAUNCH_PAIR_MODULES` and
 * `defaultLaunchPairs` in `launch/pairs.ts`.
 */
export const DEFAULT_LAUNCHER_ADDRESSES: Record<SupportedChainId, LauncherAddresses> = {
  [BASE_MAINNET_CHAIN_ID]: {
    launcher: '0x274D92df0d1CEfF9080360191feE0d3299c21B49',
    hook: '0x84bBAB8cac69bF6711BA81f9915DC346f4cF2088',
    locker: '0x68275200408371a3B34D36F1Ce058Cba2423F41F',
    devBuyExtension: '0x4FbC500e73FbB796e854446B7e2b9B2eC3e19b9c',
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    launcher: '0x52D747CfF556704A8474D8457f020DEB3Ceb8e3b',
    hook: '0xecE7af3CB736DAD42a8e61Fb2F0E26dff2c72088',
    locker: '0x1Dc85Ab6C03F7dfb5EDC94D871f4748a9D9C9CaE',
    devBuyExtension: '0x9F3c927928C9E38d9121FC5A15fb011d4B800819',
  },
} as const

/**
 * RWAGMI's default 10% launch LP fee slot by chain.
 *
 * Integrators may pass their own RwagmiFeeConfig if an upgraded deployment
 * records a different recipient or admin.
 */
export const DEFAULT_RWAGMI_FEE_CONFIG: Record<SupportedChainId, RwagmiFeeConfig> = {
  [BASE_MAINNET_CHAIN_ID]: {
    recipient: '0xB20b907C55B29fdd39680224941Eef4Cff6ebB20',
    admin: '0xB20b907C55B29fdd39680224941Eef4Cff6ebB20',
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    recipient: '0x0567176A98197F9373c056087807b1C599Fe50cd',
    admin: '0x0567176A98197F9373c056087807b1C599Fe50cd',
  },
} as const

export const WETH_BY_CHAIN: Record<SupportedChainId, Address> = {
  [BASE_MAINNET_CHAIN_ID]: BASE_WETH,
  [BASE_SEPOLIA_CHAIN_ID]: BASE_WETH,
} as const

/**
 * Current public RWAGMI v3 launcher stack by chain (Base mainnet).
 *
 * V3 launches one token across 1–5 Uniswap v4 pools in one transaction. The
 * hook takes the trading fee in each pool's paired asset (90% to the creator's
 * reward slots, 10% to RWAGMI); the native LP fee is zero and there is no
 * launch auction. Sources are verified on Basescan. `startBlock` is at or
 * before the launcher's creation block, so an indexer starting there misses
 * nothing. V2 launches keep their own stack in `DEFAULT_LAUNCHER_ADDRESSES`.
 */
export const DEFAULT_LAUNCHER_V3: Partial<Record<SupportedChainId, LauncherDeploymentV3>> = {
  [BASE_MAINNET_CHAIN_ID]: {
    version: 3,
    chainId: BASE_MAINNET_CHAIN_ID,
    launcher: '0xB205c9e7B43ca3a4aA99b82D449354CCB3294B20',
    hook: '0xB20B00367E37F826a0652c85a6DF375D784B20Ec',
    locker: '0xB205CE7CC26C35ed5E1f9655FF9d0115af4a1B20',
    devBuyExtension: '0xb20A2dCBC4AA42474072381aEb52CbFc5C751B20',
    startBlock: 52_861_401n,
  },
}

/** The v3 launcher stack for `chainId`, or null where none is deployed. */
export function defaultLauncherV3(chainId: number): LauncherDeploymentV3 | null {
  return DEFAULT_LAUNCHER_V3[chainId as SupportedChainId] ?? null
}
