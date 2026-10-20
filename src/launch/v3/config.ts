import { encodeAbiParameters, getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { buildInitCalls, encodeAssetCreateParams } from '../../create.js'
import { prepareWrite, type PreparedB20Write } from '../../tx-plan.js'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import { BASE_WETH } from '../../deployments.js'
import { buildPoolKey } from './pool-key.js'
import { launchLiquidityCurve, validateLiquidityCurve, strandedSupplyForCurve } from '../ticks.js'
import {
  allocateV3Supply,
  decimalRational,
  divideRational,
  priceToTickV3,
  priceAtTickV3,
  formatRational,
  poolIdV3,
  V3_MAX_FEE,
} from './math.js'
import type {
  LaunchConfigV3,
  LaunchDraftV3,
  LauncherDeploymentV3,
  HookFeeConfigV3,
} from './types.js'

const MAX_UINT128 = (1n << 128n) - 1n
export const STATIC_FEE_V3: HookFeeConfigV3 = {
  mode: 0,
  staticFee: 10_000,
  dynamicConfig: {
    baseFee: 0,
    maxLpFee: 0,
    feeControlNumerator: 0,
    referenceTickFilterPeriod: 0,
    resetPeriod: 0,
    decayFilterBps: 0,
  },
}
export const DYNAMIC_FEE_V3: HookFeeConfigV3 = {
  mode: 1,
  staticFee: 0,
  dynamicConfig: {
    baseFee: 10_000,
    maxLpFee: 100_000,
    feeControlNumerator: 100,
    referenceTickFilterPeriod: 30,
    resetPeriod: 300,
    decayFilterBps: 5000,
  },
}
export function validateHookFeeV3(fee: HookFeeConfigV3): void {
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max
  if (fee.mode === 0 && integer(fee.staticFee, 1, V3_MAX_FEE)) return
  const d = fee.dynamicConfig
  // Mirrors RwagmiDynamicFeeV3.initialize: settings that could never move or
  // decay the fee (no headroom, zero control, zero filter, filter >= reset) revert.
  if (
    fee.mode === 1 &&
    fee.staticFee === 0 &&
    integer(d.baseFee, 1, V3_MAX_FEE) &&
    integer(d.maxLpFee, d.baseFee + 1, V3_MAX_FEE) &&
    integer(d.feeControlNumerator, 1, 0xffffffff) &&
    integer(d.referenceTickFilterPeriod, 1, 0xffffffff) &&
    integer(d.resetPeriod, d.referenceTickFilterPeriod + 1, 0xffffffff) &&
    integer(d.decayFilterBps, 0, 10000)
  )
    return
  throw new Error('Invalid v3 hook fee configuration')
}
function address(value: Address): Address {
  if (!isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress)
    throw new Error('A nonzero address is required')
  return getAddress(value)
}
export interface BuildLaunchV3Args {
  draft: LaunchDraftV3
  deployment: LauncherDeploymentV3
  predictedToken: Address
}

export function buildLaunchV3Config({
  draft,
  deployment,
  predictedToken,
}: BuildLaunchV3Args): LaunchConfigV3 {
  address(deployment.launcher)
  address(deployment.hook)
  address(deployment.locker)
  address(predictedToken)
  if (deployment.version !== 3 || ![8453, 84532].includes(deployment.chainId))
    throw new Error('Unsupported v3 deployment')
  if (
    !draft.name.trim() ||
    new TextEncoder().encode(draft.name).length > 128 ||
    !draft.symbol.trim() ||
    new TextEncoder().encode(draft.symbol).length > 32
  )
    throw new Error('Invalid token name or symbol')
  if (!Number.isInteger(draft.decimals) || draft.decimals < 6 || draft.decimals > 18)
    throw new Error('B20 decimals must be 6–18')
  if (
    !/^0x[\da-fA-F]{64}$/.test(draft.salt) ||
    draft.liquiditySupply <= 0n ||
    draft.liquiditySupply > MAX_UINT128
  )
    throw new Error('Invalid salt or supply')
  if (draft.deadline <= 0n || draft.pools.length < 1 || draft.pools.length > 5)
    throw new Error('Choose 1–5 pools and a deadline')
  if (
    draft.creatorRewards.length < 1 ||
    draft.creatorRewards.length > 6 ||
    draft.creatorRewards.reduce((sum, r) => sum + r.bps, 0) !== 9000
  )
    throw new Error('Creator rewards must total 90% across 1–6 slots')
  for (const reward of draft.creatorRewards) {
    address(reward.admin)
    address(reward.recipient)
    if (!Number.isInteger(reward.bps) || reward.bps <= 0) throw new Error('Invalid reward share')
  }
  const tokenAdmin = draft.adminMode === 'immutable' ? zeroAddress : address(draft.initialAdmin)
  const sorted = [...draft.pools].sort((a, b) =>
    a.pair.token.toLowerCase().localeCompare(b.pair.token.toLowerCase()),
  )
  if (new Set(sorted.map((p) => p.pair.token.toLowerCase())).size !== sorted.length)
    throw new Error('Each paired asset may appear only once')
  const budgets = allocateV3Supply(
    draft.liquiditySupply,
    sorted.map((p) => p.allocationBps),
  )
  const primaryPoolIndex = sorted.findIndex(
    (p) => p.pair.token.toLowerCase() === draft.primaryPair.toLowerCase(),
  )
  if (primaryPoolIndex < 0) throw new Error('Select a primary pool from this launch')
  const tokenUsd = draft.openingMarketCapUsd
    ? divideRational(decimalRational(draft.openingMarketCapUsd), {
        numerator: draft.liquiditySupply,
        denominator: 10n ** BigInt(draft.decimals),
      })
    : null
  const pools = sorted.map((pool, i) => {
    const pair = pool.pair
    address(pair.token)
    if (
      pair.chainId !== deployment.chainId ||
      pair.token.toLowerCase() === predictedToken.toLowerCase()
    )
      throw new Error('Invalid paired asset or chain')
    if (!Number.isInteger(pair.decimals) || pair.decimals < 0 || pair.decimals > 36)
      throw new Error('Paired asset decimals are required')
    validateHookFeeV3(pool.fee)
    if (pool.priceQuote && !draft.advancedPricesAcknowledged)
      throw new Error('Acknowledge advanced per-pool prices')
    if (
      !pool.priceQuote &&
      (!tokenUsd ||
        !pool.reference ||
        pool.reference.basis !== 'raw-token' ||
        !pool.reference.source ||
        !Number.isFinite(Date.parse(pool.reference.fetchedAt)))
    )
      throw new Error(`A quote reference is required for ${pair.symbol}`)
    const price = pool.priceQuote
      ? decimalRational(pool.priceQuote)
      : divideRational(tokenUsd!, decimalRational(pool.reference!.usd))
    const tickSpacing = pool.tickSpacing ?? 200
    const tick = priceToTickV3(price, draft.decimals, pair.decimals, tickSpacing)
    const is0 = predictedToken.toLowerCase() < pair.token.toLowerCase()
    const curve =
      pool.liquidityShape === 'Custom'
        ? pool.customLiquidityCurve
        : launchLiquidityCurve(tick, tickSpacing, is0, pool.liquidityShape ?? 'Standard')
    if (!curve) throw new Error('Custom ranges are required')
    validateLiquidityCurve(curve, is0 ? tick : -tick, tickSpacing, is0, budgets[i]!, false)
    allocateV3Supply(budgets[i]!, curve.positionBps)
    return {
      pairedToken: getAddress(pair.token),
      allocationBps: pool.allocationBps,
      tickIfToken0IsB20: tick,
      tickSpacing,
      fee: pool.fee,
      positions: curve.tickLower.map((tickLower, j) => ({
        tickLower,
        tickUpper: curve.tickUpper[j]!,
        positionBps: curve.positionBps[j]!,
      })),
    }
  })
  if (pools.reduce((sum, p) => sum + p.positions.length, 0) > 25)
    throw new Error('A launch supports at most 25 positions')
  const input = {
    variant: 'asset' as const,
    name: draft.name,
    symbol: draft.symbol,
    initialAdmin: tokenAdmin,
    decimals: draft.decimals,
  }
  const extensions: LaunchConfigV3['extensions'][number][] = []
  if (draft.devBuy) {
    const buy = draft.devBuy
    const poolIndex = pools.findIndex((p) => p.pairedToken.toLowerCase() === buy.pair.toLowerCase())
    if (
      poolIndex < 0 ||
      buy.pair.toLowerCase() !== BASE_WETH.toLowerCase() ||
      !deployment.devBuyExtension
    )
      throw new Error('Creator buy requires the selected WETH pool and v3 extension')
    address(buy.recipient)
    address(deployment.devBuyExtension)
    if (
      buy.amountIn <= 0n ||
      buy.amountIn > (1n << 127n) - 1n ||
      buy.minimumOut <= 0n ||
      buy.minimumOut > MAX_UINT128
    )
      throw new Error('Creator buy needs a positive input and minimum output')
    extensions.push({
      extension: deployment.devBuyExtension,
      poolIndex,
      msgValue: buy.amountIn,
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint128' }],
        [buy.recipient, buy.minimumOut],
      ),
    })
  }
  return {
    b20Config: {
      variant: 0,
      salt: draft.salt,
      params: encodeAssetCreateParams(input),
      initCalls: buildInitCalls(input, {
        chainId: deployment.chainId,
        salt: draft.salt,
        contractURI: draft.contractURI,
        ...(draft.adminMode === 'admin'
          ? { initialSupply: draft.liquiditySupply, mintRecipient: deployment.launcher }
          : {}),
      }),
      name: draft.name,
      symbol: draft.symbol,
      decimals: draft.decimals,
      initialAdmin: tokenAdmin,
      originatingChainId: BigInt(deployment.chainId),
    },
    adminMode: draft.adminMode === 'admin' ? 1 : 0,
    liquiditySupply: draft.liquiditySupply,
    creatorRewards: draft.creatorRewards,
    pools,
    primaryPoolIndex,
    extensions,
    deadline: draft.deadline,
  }
}

export function previewLaunchV3(args: BuildLaunchV3Args) {
  const config = buildLaunchV3Config(args)
  const budgets = allocateV3Supply(
    config.liquiditySupply,
    config.pools.map((p) => p.allocationBps),
  )
  return config.pools.map((pool, i) => {
    const draft = args.draft.pools.find(
      (p) => p.pair.token.toLowerCase() === pool.pairedToken.toLowerCase(),
    )!
    const is0 = args.predictedToken.toLowerCase() < pool.pairedToken.toLowerCase()
    const key = buildPoolKey({
      token: args.predictedToken,
      pairedToken: pool.pairedToken,
      lpFee: 0,
      tickSpacing: pool.tickSpacing,
      hook: args.deployment.hook,
    })
    const curve = {
      tickLower: pool.positions.map((p) => p.tickLower),
      tickUpper: pool.positions.map((p) => p.tickUpper),
      positionBps: pool.positions.map((p) => p.positionBps),
    }
    const dust = strandedSupplyForCurve(curve, budgets[i]!, is0)
    return {
      ...pool,
      key,
      poolId: poolIdV3(key),
      quoteDecimals: draft.pair.decimals,
      quoteSymbol: draft.pair.symbol,
      allocatedSupply: budgets[i]!,
      depositedSupply: budgets[i]! - dust,
      lockedRemainder: dust,
      startingTick: is0 ? pool.tickIfToken0IsB20 : -pool.tickIfToken0IsB20,
      openingPrice: formatRational(
        priceAtTickV3(pool.tickIfToken0IsB20, args.draft.decimals, draft.pair.decimals),
        36,
      ),
      primary: i === config.primaryPoolIndex,
    }
  })
}

export function prepareLaunchV3(args: BuildLaunchV3Args): PreparedB20Write {
  const config = buildLaunchV3Config(args)
  return prepareWrite({
    kind: 'launch-b20-v3',
    label: `Launch ${args.draft.symbol} across ${config.pools.length} pools`,
    chainId: args.deployment.chainId,
    subjectToken: args.predictedToken,
    to: args.deployment.launcher,
    abi: rwagmiLauncherV3Abi,
    functionName: 'launchB20',
    args: [config],
    value: config.extensions.reduce((sum, e) => sum + e.msgValue, 0n),
    riskLevel: 'critical',
    warnings: [
      'Liquidity and allocation are permanently locked.',
      'Trading starts immediately. Fees are paid in each pool’s paired asset.',
      'Creator rewards receive 90% of the hook fee; RWAGMI receives 10%.',
    ],
  })
}
