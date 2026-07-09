/**
 * Tick + LP-fee helpers for building launch pools. Mirrors Uniswap v4 tick
 * math: tick = log_1.0001(price), where price is token1/token0 in raw units.
 */

export const MAX_TICK = 887_272
export const MIN_TICK = -887_272
export const DEFAULT_LAUNCH_LP_FEE = 10_000
export const MIN_LAUNCH_LP_FEE = 10_000
export const MAX_LAUNCH_LP_FEE = 1_000_000
export const LAUNCH_TICK_SPACING = 200

/** Suggested static LP-fee presets. Fee is in hundredths of a bip. */
export const LP_FEE_PRESETS = {
  '10000': { fee: 10_000, tickSpacing: LAUNCH_TICK_SPACING }, // 1.00% - launcher default
  '20000': { fee: 20_000, tickSpacing: LAUNCH_TICK_SPACING }, // 2.00%
  '30000': { fee: 30_000, tickSpacing: LAUNCH_TICK_SPACING }, // 3.00%
  '50000': { fee: 50_000, tickSpacing: LAUNCH_TICK_SPACING }, // 5.00%
  '100000': { fee: 100_000, tickSpacing: LAUNCH_TICK_SPACING }, // 10.00%
} as const

export type LpFeeKind = keyof typeof LP_FEE_PRESETS

export function parseLpFeePercent(value: string | number): number {
  const raw = String(value).trim()
  const parts = raw.split('.')
  if (parts.length > 2 || !parts[0] || !/^\d+$/.test(parts[0])) {
    throw new Error('LP fee must be a percentage')
  }
  const fractional = parts[1] ?? ''
  if (fractional && !/^\d{1,4}$/.test(fractional)) {
    throw new Error('LP fee supports up to four decimal places')
  }

  const fee =
    BigInt(parts[0]) * 10_000n +
    BigInt((fractional || '').padEnd(4, '0') || '0')
  if (fee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('LP fee is too large')
  }
  return Number(fee)
}

export function validateLaunchLpFee(lpFee: number): void {
  if (!Number.isSafeInteger(lpFee)) {
    throw new Error('LP fee must be an integer in hundredths of a bip')
  }
  if (lpFee < MIN_LAUNCH_LP_FEE) {
    throw new Error(`LP fee must be at least ${formatLpFeePercent(MIN_LAUNCH_LP_FEE)}`)
  }
  if (lpFee > MAX_LAUNCH_LP_FEE) {
    throw new Error(`LP fee must be at most ${formatLpFeePercent(MAX_LAUNCH_LP_FEE)}`)
  }
}

export function formatLpFeePercent(
  lpFee: number,
  options: {
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  } = {},
): string {
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 4,
  } = options
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(lpFee / 10_000)}%`
}

/** Reference tick the built-in liquidity presets are authored around. */
export const POOL_PRESET_START_TICK = -230_400

export interface PoolPosition {
  tickLower: number
  tickUpper: number
  positionBps: number
}

export const POOL_POSITIONS = {
  Standard: [
    {
      tickLower: -230_400,
      tickUpper: -120_000,
      positionBps: 10_000,
    },
  ],
  Project: [
    {
      tickLower: -230_400,
      tickUpper: -214_000,
      positionBps: 1_000,
    },
    {
      tickLower: -214_000,
      tickUpper: -155_000,
      positionBps: 5_000,
    },
    {
      tickLower: -202_000,
      tickUpper: -155_000,
      positionBps: 1_500,
    },
    {
      tickLower: -155_000,
      tickUpper: -120_000,
      positionBps: 2_000,
    },
    {
      tickLower: -141_000,
      tickUpper: -120_000,
      positionBps: 500,
    },
  ],
} as const satisfies Record<string, readonly PoolPosition[]>

export type LiquidityShape = keyof typeof POOL_POSITIONS | 'Custom'

export interface LiquidityCurve {
  tickLower: readonly number[]
  tickUpper: readonly number[]
  positionBps: readonly number[]
}

/** Largest tick aligned to `spacing` that is <= MAX_TICK. */
export function maxUsableTick(spacing: number): number {
  return Math.floor(MAX_TICK / spacing) * spacing
}

/** Smallest tick aligned to `spacing` that is >= MIN_TICK. */
export function minUsableTick(spacing: number): number {
  return Math.ceil(MIN_TICK / spacing) * spacing
}

/** Round `tick` to a multiple of `spacing` (down by default, up when roundUp). */
export function alignTick(tick: number, spacing: number, roundUp = false): number {
  const q = tick / spacing
  return (roundUp ? Math.ceil(q) : Math.floor(q)) * spacing
}

/** Round a price-derived starting tick down to the pool tick spacing. */
export function alignStartingTick(tick: number, spacing: number): number {
  return alignTick(tick, spacing)
}

/**
 * Convert a human price (paired-per-B20) into the v4 starting tick expressed as
 * though the B20 is currency0 (token0). Decimals are folded into the raw ratio.
 */
export function priceToStartingTick(
  pairedPerB20: number,
  b20Decimals = 18,
  pairedDecimals = 18,
): number {
  if (!(pairedPerB20 > 0)) throw new Error('initial price must be > 0')
  const rawPrice = pairedPerB20 * 10 ** (pairedDecimals - b20Decimals)
  return Math.floor(Math.log(rawPrice) / Math.log(1.0001))
}

/**
 * One-sided launch range: a single position holding only B20, entirely on the
 * B20 side of `startingTick` (the actual, post-sort pool tick). Both bounds are
 * aligned to `spacing` and strictly on the B20 side so no paired token is owed.
 */
export function launchTickRange(
  startingTick: number,
  spacing: number,
  b20IsCurrency0: boolean,
): { tickLower: number; tickUpper: number } {
  if (b20IsCurrency0) {
    let tickLower = alignTick(startingTick, spacing, true)
    if (tickLower < startingTick) tickLower += spacing
    return { tickLower, tickUpper: maxUsableTick(spacing) }
  }
  let tickUpper = alignTick(startingTick, spacing, true)
  if (tickUpper > startingTick) tickUpper -= spacing
  return { tickLower: minUsableTick(spacing), tickUpper }
}

export function launchLiquidityCurve(
  tickIfToken0IsB20: number,
  spacing: number,
  b20IsCurrency0: boolean,
  shape: Exclude<LiquidityShape, 'Custom'> = 'Standard',
): LiquidityCurve {
  const token0Positions = POOL_POSITIONS[shape].map((position) =>
    shiftPresetPosition(position, tickIfToken0IsB20, spacing),
  )
  const positions = token0Positions.map((position) => orientPosition(position, b20IsCurrency0))
  return {
    tickLower: positions.map((position) => position.tickLower),
    tickUpper: positions.map((position) => position.tickUpper),
    positionBps: token0Positions.map((position) => position.positionBps),
  }
}

function shiftPresetPosition(
  position: PoolPosition,
  tickIfToken0IsB20: number,
  spacing: number,
): PoolPosition {
  const startingTick = alignStartingTick(tickIfToken0IsB20, spacing)
  const offset = startingTick - POOL_PRESET_START_TICK
  const maxTick = maxUsableTick(spacing)
  if (startingTick < minUsableTick(spacing) || startingTick >= maxTick) {
    throw new Error('launch starting tick is outside the usable tick range')
  }
  const rawLower = position.tickLower + offset
  const rawUpper = position.tickUpper + offset
  const tickLower =
    position.tickLower === POOL_PRESET_START_TICK
      ? startingTick
      : Math.max(startingTick, alignTick(rawLower, spacing))
  const tickUpper = Math.min(maxTick, alignTick(rawUpper, spacing))
  if (tickLower >= tickUpper) {
    throw new Error('liquidity preset does not fit above the launch tick')
  }
  return {
    tickLower,
    tickUpper,
    positionBps: position.positionBps,
  }
}

function orientPosition(position: PoolPosition, b20IsCurrency0: boolean): PoolPosition {
  if (b20IsCurrency0) return position
  return {
    tickLower: normalizeTick(-position.tickUpper),
    tickUpper: normalizeTick(-position.tickLower),
    positionBps: position.positionBps,
  }
}

function normalizeTick(tick: number): number {
  return Object.is(tick, -0) ? 0 : tick
}

export function validateLiquidityCurve(
  curve: LiquidityCurve,
  startingTick: number,
  spacing: number,
  b20IsCurrency0: boolean,
): void {
  const n = curve.tickLower.length
  if (n === 0) throw new Error('liquidity curve must include at least one position')
  if (n > 7) throw new Error('liquidity curve supports at most 7 positions')
  if (curve.tickUpper.length !== n || curve.positionBps.length !== n) {
    throw new Error('liquidity curve arrays must have matching lengths')
  }
  const totalBps = curve.positionBps.reduce((sum, bps) => sum + bps, 0)
  if (totalBps !== 10_000) throw new Error('liquidity position bps must sum to 10000')
  let touchesLaunchTick = false

  for (let i = 0; i < n; i++) {
    const lower = curve.tickLower[i]!
    const upper = curve.tickUpper[i]!
    if (lower >= upper) throw new Error('liquidity position lower tick must be below upper tick')
    if (lower < minUsableTick(spacing) || upper > maxUsableTick(spacing)) {
      throw new Error('liquidity position ticks must be within usable tick bounds')
    }
    if (lower % spacing !== 0 || upper % spacing !== 0) {
      throw new Error('liquidity position ticks must align to tick spacing')
    }
    if (b20IsCurrency0) {
      if (lower < startingTick) {
        throw new Error('liquidity curve must stay on the B20 side of the launch tick')
      }
      if (lower === startingTick) touchesLaunchTick = true
    } else {
      if (upper > startingTick) {
        throw new Error('liquidity curve must stay on the B20 side of the launch tick')
      }
      if (upper === startingTick) touchesLaunchTick = true
    }
  }

  if (!touchesLaunchTick) {
    throw new Error('liquidity curve must include a position touching the launch tick edge')
  }
}
