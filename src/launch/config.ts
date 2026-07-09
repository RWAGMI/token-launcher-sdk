import { encodeAbiParameters, getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { MAX_ASSET_DECIMALS, MIN_ASSET_DECIMALS } from '../constants.js'
import { buildInitCalls, encodeAssetCreateParams } from '../create.js'
import { prepareWrite, type PreparedB20Write } from '../tx-plan.js'
import { rwagmiLauncherAbi } from '../abi/rwagmi-launcher.js'
import {
  DEFAULT_LAUNCH_LP_FEE,
  LAUNCH_TICK_SPACING,
  alignStartingTick,
  launchLiquidityCurve,
  priceToStartingTick,
  validateLaunchLpFee,
  validateLiquidityCurve,
  type LiquidityCurve,
  type LiquidityShape,
} from './ticks.js'
import type { LauncherAddresses, RwagmiFeeConfig } from './addresses.js'

/** Default split: 90% creator / 10% RWAGMI of launch LP fees. */
export const CREATOR_REWARD_BPS = 9000
export const RWAGMI_REWARD_BPS = 1000

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
  if ((draft.devBuyEth ?? 0n) > 0n && !draft.devBuyRecipient && !draft.creatorRecipient) {
    throw new Error('dev buy recipient is required')
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

  const fee = draft.lpFee ?? DEFAULT_LAUNCH_LP_FEE
  const tickSpacing = LAUNCH_TICK_SPACING
  const pairedDecimals = draft.pairedDecimals ?? 18

  const startingTick = alignStartingTick(
    priceToStartingTick(draft.initialPrice, draft.decimals, pairedDecimals),
    tickSpacing,
  )
  // Sort by checksum-normalised lowercase address, matching on-chain uint160 compare.
  const b20IsCurrency0 = getAddress(predictedToken).toLowerCase() < getAddress(draft.pairedToken).toLowerCase()
  const actualStartTick = b20IsCurrency0 ? startingTick : -startingTick
  const shape = draft.liquidityShape ?? 'Standard'
  const liquidityCurve =
    shape === 'Custom'
      ? draft.customLiquidityCurve!
      : launchLiquidityCurve(startingTick, tickSpacing, b20IsCurrency0, shape)
  validateLiquidityCurve(liquidityCurve, actualStartTick, tickSpacing, b20IsCurrency0)

  const adminMode = draft.adminMode ?? 'immutable'
  const tokenAdmin = adminMode === 'immutable' ? zeroAddress : draft.initialAdmin
  const extensionConfigs = buildExtensionConfigs(draft, addresses)
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
      pairedToken: draft.pairedToken,
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
    mevModuleConfig: { mevModule: addresses.mevModule, mevModuleData: '0x' },
    extensionConfigs,
    poolSupply: draft.poolSupply,
    adminMode: adminMode === 'immutable' ? 0 : 1,
  }
}

function buildExtensionConfigs(
  draft: LaunchDraft,
  addresses: LauncherAddresses,
): LaunchConfigStruct['extensionConfigs'] {
  const devBuyEth = draft.devBuyEth ?? 0n
  if (devBuyEth <= 0n) return []
  if (!addresses.devBuyExtension) throw new Error('dev buy extension is not configured')

  return [
    {
      extension: addresses.devBuyExtension,
      msgValue: devBuyEth,
      extensionBps: 0,
      extensionData: encodeDevBuyData({
        recipient: draft.devBuyRecipient ?? draft.creatorRecipient,
        amountOutMinimum: draft.devBuyAmountOutMinimum ?? 0n,
      }),
    },
  ]
}

export function encodeDevBuyData({
  recipient,
  amountOutMinimum = 0n,
}: {
  recipient: Address
  amountOutMinimum?: bigint
}): Hex {
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
  return prepareWrite({
    kind: 'launchB20',
    label: `Launch ${args.draft.symbol} with a Uniswap v4 pool`,
    chainId: args.chainId,
    to: args.addresses.launcher,
    abi: rwagmiLauncherAbi,
    functionName: 'launchB20',
    args: [config],
    value: config.extensionConfigs.reduce((sum, ext) => sum + ext.msgValue, 0n),
    riskLevel: 'critical',
    warnings: [
      'One transaction creates the B20 token and initializes its Uniswap v4 pool.',
      'The launch auction is mandatory for the first swap window.',
      args.draft.adminMode === 'admin'
        ? 'Admin powers remain live; the admin can later grant Asset operator and rebase the token.'
        : 'The token is created immutable with no B20 admin.',
      'RWAGMI receives 10% of the launch LP position fees. This is not an extra swap fee.',
      'Launch LP fee split is fixed at 90% creator / 10% RWAGMI and cannot change after launch.',
    ],
  })
}
