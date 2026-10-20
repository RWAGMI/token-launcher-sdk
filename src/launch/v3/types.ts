import type { Address, Hex, ContractFunctionArgs } from 'viem'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import type { LiquidityShape, LiquidityCurve } from '../ticks.js'
import type { V4PoolKey } from './pool-key.js'

export type LaunchConfigV3 = ContractFunctionArgs<
  typeof rwagmiLauncherV3Abi,
  'payable',
  'launchB20'
>[0]
export type HookFeeConfigV3 = LaunchConfigV3['pools'][number]['fee']
export type RewardSlotV3 = LaunchConfigV3['creatorRewards'][number]

export interface LauncherDeploymentV3 {
  version: 3
  chainId: number
  launcher: Address
  hook: Address
  locker: Address
  devBuyExtension?: Address
  startBlock: bigint
}
export interface LaunchPairV3 {
  chainId: number
  token: Address
  symbol: string
  decimals: number
  supportsEthDevBuy?: boolean
}
export interface QuoteReferenceV3 {
  usd: string
  source: string
  marketTimestamp: string | null
  fetchedAt: string
  /** The provider could not refresh this bounded cached reference. */
  stale?: boolean
  basis: 'raw-token'
  multiplierBlock?: string
}
export interface LaunchPoolDraftV3 {
  pair: LaunchPairV3
  allocationBps: number
  fee: HookFeeConfigV3
  tickSpacing?: number
  liquidityShape?: LiquidityShape
  customLiquidityCurve?: LiquidityCurve
  reference?: QuoteReferenceV3
  /** Explicit advanced override, in human quote tokens per launch token. */
  priceQuote?: string
}
export interface LaunchDraftV3 {
  name: string
  symbol: string
  decimals: number
  contractURI?: string
  salt: Hex
  liquiditySupply: bigint
  creatorRewards: readonly RewardSlotV3[]
  adminMode: 'immutable' | 'admin'
  initialAdmin: Address
  pools: readonly LaunchPoolDraftV3[]
  primaryPair: Address
  openingMarketCapUsd?: string
  advancedPricesAcknowledged?: boolean
  deadline: bigint
  devBuy?: { pair: Address; amountIn: bigint; minimumOut: bigint; recipient: Address }
}
export interface LaunchPositionV3 {
  id: bigint
  tickLower: number
  tickUpper: number
  liquidity: bigint
}
export interface LaunchPoolResultV3 {
  poolId: Hex
  index: number
  key: V4PoolKey
  pairedToken: Address
  allocationBps: number
  allocatedSupply: bigint
  depositedSupply: bigint
  lockedRemainder: bigint
  startingTick: number
  fee: HookFeeConfigV3
  positions: readonly LaunchPositionV3[]
}
export interface LaunchResultV3 {
  version: 3
  token: Address
  creator: Address
  tokenAdmin: Address
  name: string
  symbol: string
  decimals: number
  adminMode: 'immutable' | 'admin'
  hook: Address
  locker: Address
  primaryPoolId: Hex
  totalSupply: bigint
  liquiditySupply: bigint
  extensionSupply: bigint
  launchTimestamp: bigint
  rewardConfigurationHash: Hex
  pools: readonly LaunchPoolResultV3[]
}
