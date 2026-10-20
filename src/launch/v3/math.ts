import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import { getSqrtPriceAtTick } from '../liquidity-math.js'
import type { V4PoolKey } from './pool-key.js'

export interface Rational {
  numerator: bigint
  denominator: bigint
}
export const V3_MAX_FEE = 100_000
export const V3_MAX_POOLS = 5
export const V3_MAX_POSITIONS = 25

/** Exact decimal parsing, including bounded scientific notation from price feeds. */
export function decimalRational(value: string): Rational {
  if (value.length > 160) throw new Error('Decimal input is too long')
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!m) throw new Error('Enter a positive decimal number')
  const exponent = Number(m[3] ?? 0) - (m[2]?.length ?? 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100)
    throw new Error('Decimal exponent is out of range')
  const integer = BigInt(m[1]! + (m[2] ?? ''))
  if (integer <= 0n) throw new Error('Amount must be positive')
  return exponent >= 0
    ? { numerator: integer * 10n ** BigInt(exponent), denominator: 1n }
    : { numerator: integer, denominator: 10n ** BigInt(-exponent) }
}

export function divideRational(a: Rational, b: Rational): Rational {
  if (a.denominator <= 0n || b.denominator <= 0n || b.numerator <= 0n)
    throw new Error('Invalid rational')
  return { numerator: a.numerator * b.denominator, denominator: a.denominator * b.numerator }
}

export function formatRational(value: Rational, places = 18): string {
  if (!Number.isInteger(places) || places < 0 || places > 100 || value.denominator <= 0n)
    throw new Error('Invalid precision')
  const scaled = (value.numerator * 10n ** BigInt(places)) / value.denominator
  if (places === 0) return scaled.toString()
  const digits = scaled.toString().padStart(places + 1, '0')
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '') || '0'
}

export function allocateV3Supply(total: bigint, bps: readonly number[]): bigint[] {
  if (
    total <= 0n ||
    bps.length === 0 ||
    bps.some((b) => !Number.isInteger(b) || b <= 0) ||
    bps.reduce((a, b) => a + b, 0) !== 10_000
  )
    throw new Error('Allocations must total 100%')
  let allocated = 0n
  return bps.map((b, i) => {
    const amount = i === bps.length - 1 ? total - allocated : (total * BigInt(b)) / 10_000n
    if (amount === 0n) throw new Error('Allocation is too small')
    allocated += amount
    return amount
  })
}

/** Millionths; quoteAmount is specified quote for precharged cases, pool quote otherwise. */
export function quoteFeeV3(
  quoteAmount: bigint,
  rate: number,
  buy: boolean,
  exactInput: boolean,
): bigint {
  if (quoteAmount < 0n || !Number.isInteger(rate) || rate <= 0 || rate > V3_MAX_FEE)
    throw new Error('Invalid quote fee')
  const f = BigInt(rate)
  const denominator = 1_000_000n + (buy && exactInput ? f : !buy && !exactInput ? -f : 0n)
  return (quoteAmount * f + denominator - 1n) / denominator
}

/** Price expressed as quote human units per launch token; returns token0-is-B20 tick. */
export function priceToTickV3(
  price: Rational,
  tokenDecimals: number,
  quoteDecimals: number,
  spacing = 200,
): number {
  for (const decimals of [tokenDecimals, quoteDecimals])
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
      throw new Error('Invalid token decimals')
  if (
    !Number.isInteger(spacing) ||
    spacing < 1 ||
    spacing > 32767 ||
    price.numerator <= 0n ||
    price.denominator <= 0n
  )
    throw new Error('Invalid price or tick spacing')
  const numerator = price.numerator * 10n ** BigInt(quoteDecimals)
  const denominator = price.denominator * 10n ** BigInt(tokenDecimals)
  const target = numerator * (1n << 192n)
  const under = (tick: number) => getSqrtPriceAtTick(tick) ** 2n * denominator <= target
  if (!under(-887272) || under(887272))
    throw new Error('Price is outside the launchable tick range')
  let low = -887272
  let high = 887272
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (under(mid)) low = mid
    else high = mid - 1
  }
  const aligned = Math.floor(low / spacing) * spacing
  if (aligned < -887272 || aligned + spacing > 887272)
    throw new Error('Price is outside the launchable tick range')
  return Object.is(aligned, -0) ? 0 : aligned
}

export function priceAtTickV3(
  tick: number,
  tokenDecimals: number,
  quoteDecimals: number,
): Rational {
  return {
    numerator: getSqrtPriceAtTick(tick) ** 2n * 10n ** BigInt(tokenDecimals),
    denominator: (1n << 192n) * 10n ** BigInt(quoteDecimals),
  }
}

export function poolIdV3(key: V4PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  )
}
