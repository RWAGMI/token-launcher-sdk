import {
  encodeAbiParameters,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { MAX_ASSET_DECIMALS, MIN_ASSET_DECIMALS } from '../constants.js'
import { buildInitCalls, encodeAssetCreateParams } from '../create.js'
import { prepareWrite, type PreparedB20Write } from '../tx-plan.js'
import { rwagmiLauncherAbi } from '../abi/rwagmi-launcher.js'
import {
  DEFAULT_LAUNCH_LP_FEE,
  LAUNCH_TICK_SPACING,
  alignedStartingPrice,
  launchLiquidityCurve,
  validateLaunchLpFee,
  validateLiquidityCurve,
  type LiquidityCurve,
  type LiquidityShape,
} from './ticks.js'
import type { LauncherAddresses, RwagmiFeeConfig } from './addresses.js'
import type { LaunchPairConfig } from './pairs.js'

/** Default split: 90% creator / 10% RWAGMI of launch LP fees. */
export const CREATOR_REWARD_BPS = 9000
export const RWAGMI_REWARD_BPS = 1000
/** Largest minimum output encodable by RwagmiEthDevBuy.DevBuyConfig. */
export const MAX_DEV_BUY_AMOUNT_OUT_MINIMUM = (1n << 128n) - 1n

/** Raw form state for one launch. Supply is already in base units. */
export interface LaunchDraft {
  variant: 'asset'
  name: string
  symbol: string
  decimals: number
  contractURI?: string
  salt: Hex
  poolSupply: bigint
  creatorRecipient: Address
  creatorAdmin: Address
  pairedToken: Address
  pairedDecimals?: number
  /** Static Uniswap v4 LP fee in hundredths of a bip. Defaults to 1.00%. */
  lpFee?: number
  /** Paired token per 1 B20, human units. */
  initialPrice: number
  /** B20 DEFAULT_ADMIN_ROLE holder. */
  initialAdmin: Address
  adminMode?: 'immutable' | 'admin'
  liquidityShape?: LiquidityShape
  customLiquidityCurve?: LiquidityCurve
  devBuyEth?: bigint
  devBuyRecipient?: Address
  devBuyAmountOutMinimum?: bigint
}

export interface BuildLaunchArgs {
  draft: LaunchDraft
  chainId: number
  addresses: LauncherAddresses
  rwagmiFee: RwagmiFeeConfig
  /** Address the B20 will deploy to (predictB20Address with the launcher as deployer). */
  predictedToken: Address
  /**
   * The curated pair this launch uses, from `resolveLaunchPairs`. Required and
   * authoritative: the pair entry — not the draft — decides the paired token,
   * its decimals, the pair-bound auction module, and dev-buy eligibility.
   */
  pair: LaunchPairConfig
}

/** Object shape viem encodes into the launcher's LaunchConfig tuple. */
export interface LaunchConfigStruct {
  b20Config: {
    variant: number
    salt: Hex
    params: Hex
    initCalls: readonly Hex[]
    name: string
    symbol: string
    decimals: number
    initialAdmin: Address
    originatingChainId: bigint
  }
  poolConfig: {
    hook: Address
    pairedToken: Address
    lpFee: number
    tickIfToken0IsB20: number
    tickSpacing: number
    poolData: Hex
  }
  lockerConfig: {
    locker: Address
    rewardAdmins: readonly Address[]
    rewardRecipients: readonly Address[]
    rewardBps: readonly number[]
    tickLower: readonly number[]
    tickUpper: readonly number[]
    positionBps: readonly number[]
    lockerData: Hex
  }
  mevModuleConfig: { mevModule: Address; mevModuleData: Hex }
  extensionConfigs: readonly {
    extension: Address
    msgValue: bigint
    extensionBps: number
    extensionData: Hex
  }[]
  poolSupply: bigint
  adminMode: number
}

const DEV_BUY_CONFIG_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'recipient', type: 'address' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'pairedTokenPoolKey', type: 'bytes' },
    ],
  },
] as const

function validate(draft: LaunchDraft): void {
  if (draft.variant !== 'asset') throw new Error('the RWAGMI launcher supports the Asset variant only')
  if (
    !Number.isInteger(draft.decimals) ||
    draft.decimals < MIN_ASSET_DECIMALS ||
    draft.decimals > MAX_ASSET_DECIMALS
  ) {
    throw new Error(`decimals must be an integer ${MIN_ASSET_DECIMALS}-${MAX_ASSET_DECIMALS}`)
  }
  if (draft.poolSupply <= 0n) throw new Error('pool supply must be > 0')
  validateLaunchLpFee(draft.lpFee ?? DEFAULT_LAUNCH_LP_FEE)
  if (draft.liquidityShape === 'Custom' && !draft.customLiquidityCurve) {
    throw new Error('custom liquidity curve is required')
  }
}

/**
 * Convert form state into the launcher's LaunchConfig. Pure + deterministic:
 * predicts nothing itself — the caller supplies `predictedToken` (used only to
 * sort currencies and orient the one-sided launch range). The reward split is
 * fixed at 90/10 and bps are immutable on-chain post-launch.
 */
export function buildLaunchConfig(args: BuildLaunchArgs): LaunchConfigStruct {
  const { draft, chainId, addresses, rwagmiFee, predictedToken } = args
  validate(draft)
  const pair = resolvePair(args)

  const fee = draft.lpFee ?? DEFAULT_LAUNCH_LP_FEE
  const tickSpacing = LAUNCH_TICK_SPACING
  // Registry decimals are mandatory. The old `?? 18` fallback silently
  // mis-scaled every non-18-decimal pair by 10 ** (18 - decimals) — a factor of
  // 10^10 for the 8-decimal B20 stocks.
  const pairedDecimals = pair.decimals

  const { startingTick } = alignedStartingPrice(
    draft.initialPrice,
    draft.decimals,
    pairedDecimals,
    tickSpacing,
  )
  // Sort by checksum-normalised lowercase address, matching on-chain uint160 compare.
  const b20IsCurrency0 = getAddress(predictedToken).toLowerCase() < getAddress(pair.token).toLowerCase()
  const actualStartTick = b20IsCurrency0 ? startingTick : -startingTick
  const shape = draft.liquidityShape ?? 'Standard'
  const liquidityCurve =
    shape === 'Custom'
      ? draft.customLiquidityCurve!
      : launchLiquidityCurve(startingTick, tickSpacing, b20IsCurrency0, shape)
  // The locker receives exactly `poolSupply`; extension supply is minted
  // separately and never reaches `placeLiquidity`.
  validateLiquidityCurve(
    liquidityCurve,
    actualStartTick,
    tickSpacing,
    b20IsCurrency0,
    draft.poolSupply,
  )

  const adminMode = draft.adminMode ?? 'immutable'
  const tokenAdmin = adminMode === 'immutable' ? zeroAddress : draft.initialAdmin
  const extensionConfigs = buildExtensionConfigs(draft, addresses, pair)
  const extensionSupply = extensionConfigs.reduce(
    (sum, ext) => sum + (draft.poolSupply * BigInt(ext.extensionBps)) / 10_000n,
    0n,
  )
  const totalMintSupply = draft.poolSupply + extensionSupply

  const params = encodeAssetCreateParams({
    variant: 'asset',
    name: draft.name,
    symbol: draft.symbol,
    initialAdmin: tokenAdmin,
    decimals: draft.decimals,
  })

  const metadataInitCalls = draft.contractURI
    ? buildInitCalls(
        {
          variant: 'asset',
          name: draft.name,
          symbol: draft.symbol,
          initialAdmin: tokenAdmin,
          decimals: draft.decimals,
        },
        {
          chainId,
          salt: draft.salt,
          contractURI: draft.contractURI,
        },
      )
    : []

  const initCalls =
    adminMode === 'immutable'
      ? metadataInitCalls
      : buildInitCalls(
          {
            variant: 'asset',
            name: draft.name,
            symbol: draft.symbol,
            initialAdmin: tokenAdmin,
            decimals: draft.decimals,
          },
          {
            chainId,
            salt: draft.salt,
            initialSupply: totalMintSupply,
            mintRecipient: addresses.launcher,
            contractURI: draft.contractURI,
          },
        )

  return {
    b20Config: {
      variant: 0,
      salt: draft.salt,
      params,
      initCalls,
      name: draft.name,
      symbol: draft.symbol,
      decimals: draft.decimals,
      initialAdmin: tokenAdmin,
      originatingChainId: BigInt(chainId),
    },
    poolConfig: {
      hook: addresses.hook,
      pairedToken: pair.token,
      lpFee: fee,
      tickIfToken0IsB20: startingTick,
      tickSpacing,
      poolData: '0x',
    },
    lockerConfig: {
      locker: addresses.locker,
      rewardAdmins: [draft.creatorAdmin, rwagmiFee.admin],
      rewardRecipients: [draft.creatorRecipient, rwagmiFee.recipient],
      rewardBps: [CREATOR_REWARD_BPS, RWAGMI_REWARD_BPS],
      tickLower: liquidityCurve.tickLower,
      tickUpper: liquidityCurve.tickUpper,
      positionBps: liquidityCurve.positionBps,
      lockerData: '0x',
    },
    // The pair-bound module for this exact pair. Never `addresses.mevModule`:
    // the launcher allowlists pairs and modules independently, so a shared
    // default module would let a mismatched combination be built.
    mevModuleConfig: { mevModule: pair.mevModule, mevModuleData: '0x' },
    extensionConfigs,
    poolSupply: draft.poolSupply,
    adminMode: adminMode === 'immutable' ? 0 : 1,
  }
}

/**
 * Resolve and cross-check the curated pair for this launch.
 *
 * `launchB20` is publicly callable, so on-chain binding is the real defense —
 * but the SDK must never prepare a transaction that is known to revert.
 */
function resolvePair(args: BuildLaunchArgs): LaunchPairConfig {
  const { draft, chainId, pair } = args
  if (!pair) {
    throw new Error(
      `paired token ${draft.pairedToken} is not an approved launch pair on chain ${chainId}`,
    )
  }
  if (pair.chainId !== chainId) {
    throw new Error(`selected pair is registered for chain ${pair.chainId}, not ${chainId}`)
  }
  if (getAddress(pair.token) !== getAddress(draft.pairedToken)) {
    throw new Error(
      `draft paired token ${draft.pairedToken} does not match the selected pair ${pair.token}`,
    )
  }
  assertNonZeroAddress(pair.mevModule, 'pair auction module')
  if (!Number.isInteger(pair.decimals) || pair.decimals < 0 || pair.decimals > 36) {
    throw new Error(`selected pair has invalid decimals: ${pair.decimals}`)
  }
  // A draft may carry decimals from an earlier pair selection; a stale value
  // would silently move the opening price by orders of magnitude.
  if (draft.pairedDecimals !== undefined && draft.pairedDecimals !== pair.decimals) {
    throw new Error(
      `draft paired decimals ${draft.pairedDecimals} do not match the selected pair (${pair.decimals})`,
    )
  }
  return pair
}

function buildExtensionConfigs(
  draft: LaunchDraft,
  addresses: LauncherAddresses,
  pair: LaunchPairConfig,
): LaunchConfigStruct['extensionConfigs'] {
  const devBuyEth = draft.devBuyEth ?? 0n
  if (devBuyEth < 0n) throw new Error('dev buy ETH cannot be negative')
  if (devBuyEth === 0n) return []
  // `RwagmiEthDevBuy` reverts with PairedTokenMustBeWeth on any non-WETH pair.
  // Fail here rather than build a transaction that is guaranteed to revert.
  if (!pair.supportsEthDevBuy) {
    throw new Error(
      `creator dev buy is only available for the WETH pair; ${pair.symbol} launches must use devBuyEth = 0`,
    )
  }
  if (!addresses.devBuyExtension) throw new Error('dev buy extension is not configured')
  assertNonZeroAddress(addresses.devBuyExtension, 'dev buy extension')

  const recipient = draft.devBuyRecipient ?? draft.creatorRecipient
  assertNonZeroAddress(recipient, 'dev buy recipient')

  if (draft.devBuyAmountOutMinimum === undefined) {
    throw new Error('dev buy minimum output is required')
  }
  assertPositiveDevBuyMinimum(draft.devBuyAmountOutMinimum)

  return [
    {
      extension: addresses.devBuyExtension,
      msgValue: devBuyEth,
      extensionBps: 0,
      extensionData: encodeDevBuyData({
        recipient,
        amountOutMinimum: draft.devBuyAmountOutMinimum,
      }),
    },
  ]
}

export function encodeDevBuyData({
  recipient,
  amountOutMinimum,
}: {
  recipient: Address
  amountOutMinimum: bigint
}): Hex {
  assertNonZeroAddress(recipient, 'dev buy recipient')
  assertPositiveDevBuyMinimum(amountOutMinimum)
  return encodeAbiParameters(DEV_BUY_CONFIG_TUPLE, [
    {
      recipient,
      amountOutMinimum,
      pairedTokenPoolKey: '0x',
    },
  ])
}

/** Build the reviewable, not-yet-submitted launch transaction. */
export function prepareLaunchB20(args: BuildLaunchArgs): PreparedB20Write {
  const config = buildLaunchConfig(args)
  const devBuyEth = args.draft.devBuyEth ?? 0n
  const devBuyWarning =
    devBuyEth > 0n
      ? `Creator buy attaches ${formatEther(devBuyEth)} ETH and reverts unless at least ${formatUnits(args.draft.devBuyAmountOutMinimum!, args.draft.decimals)} ${args.draft.symbol} is received.`
      : null
  return prepareWrite({
    kind: 'launchB20',
    label: `Launch ${args.draft.symbol} with a Uniswap v4 pool`,
    chainId: args.chainId,
    subjectToken: args.predictedToken,
    to: args.addresses.launcher,
    abi: rwagmiLauncherAbi,
    functionName: 'launchB20',
    args: [config],
    value: config.extensionConfigs.reduce((sum, ext) => sum + ext.msgValue, 0n),
    riskLevel: 'critical',
    warnings: [
      'One transaction creates the B20 token and initializes its Uniswap v4 pool.',
      ...(devBuyWarning ? [devBuyWarning] : []),
      'The launch auction is mandatory for the first swap window.',
      args.draft.adminMode === 'admin'
        ? 'Admin powers remain live; the admin can later grant Asset operator and rebase the token.'
        : 'The token is created immutable with no B20 admin.',
      'RWAGMI receives 10% of the launch LP position fees. This is not an extra swap fee.',
      'Launch LP fee split is fixed at 90% creator / 10% RWAGMI and cannot change after launch.',
    ],
  })
}

function assertNonZeroAddress(value: unknown, label: string): asserts value is Address {
  if (
    typeof value !== 'string' ||
    !isAddress(value) ||
    getAddress(value).toLowerCase() === zeroAddress
  ) {
    throw new Error(`${label} must be a non-zero address`)
  }
}

function assertPositiveDevBuyMinimum(value: bigint): void {
  if (value <= 0n) throw new Error('dev buy minimum output must be greater than zero')
  if (value > MAX_DEV_BUY_AMOUNT_OUT_MINIMUM) {
    throw new Error('dev buy minimum output exceeds uint128')
  }
}
