import type { Address } from 'viem'

/**
 * Singleton precompile addresses for B20 infrastructure.
 * Source: base-std `src/StdPrecompiles.sol`. Confirm against the target
 * network before relying on these for production deploys.
 */
export const B20_PRECOMPILES = {
  /** B20Factory singleton precompile. */
  factory: '0xB20f000000000000000000000000000000000000' as Address,
  /** PolicyRegistry singleton precompile. */
  policyRegistry: '0x8453000000000000000000000000000000000002' as Address,
  /** ActivationRegistry singleton precompile. */
  activationRegistry: '0x8453000000000000000000000000000000000001' as Address,
} as const

/**
 * Encoding version for createB20 params (B20FactoryLib
 * B20_ASSET_CREATE_PARAMS_VERSION / B20_STABLECOIN_CREATE_PARAMS_VERSION).
 * Currently 1 for both variants.
 */
export const B20_CREATE_PARAMS_VERSION = 1

/**
 * PausableFeature enum from base-std IB20.sol. Values are the on-wire uint8.
 */
export const PAUSABLE_FEATURE = {
  TRANSFER: 0,
  MINT: 1,
  BURN: 2,
} as const
export type PausableFeatureName = keyof typeof PAUSABLE_FEATURE
export const PAUSABLE_FEATURE_NAMES = Object.keys(
  PAUSABLE_FEATURE,
) as PausableFeatureName[]

/** B20Factory variant enum. */
export const B20_VARIANT = {
  ASSET: 0,
  STABLECOIN: 1,
} as const

/** PolicyRegistry policy type enum. */
export const POLICY_TYPE = {
  BLOCKLIST: 0,
  ALLOWLIST: 1,
} as const

/** Asset variant decimal bounds and supply-cap sentinel (B20Constants.sol). */
export const MIN_ASSET_DECIMALS = 6
export const MAX_ASSET_DECIMALS = 18
export const STABLECOIN_DECIMALS = 6
/** type(uint128).max — the "uncapped" supply sentinel. */
export const MAX_SUPPLY_CAP = (1n << 128n) - 1n

/**
 * True when a raw supplyCap read means "uncapped". Base returns
 * `type(uint128).max` for uncapped tokens; treat that and undefined alike.
 * Use this everywhere a cap is displayed or compared.
 */
export function isUncappedSupply(cap: bigint | undefined): boolean {
  return cap === undefined || cap >= MAX_SUPPLY_CAP
}

/** WAD (1e18) — precision of the Asset variant rebase multiplier. */
export const WAD = 10n ** 18n

export type B20Variant = 'asset' | 'stablecoin' | 'unknown'
