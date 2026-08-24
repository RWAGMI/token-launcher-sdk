/**
 * Exact integer ports of the Uniswap maths the locker actually executes.
 *
 * The launch guard has to answer one question: of the supply handed to
 * `placeLiquidity`, how much will the mint fail to deposit and leave stranded
 * in the locker forever? Answering it approximately is what went wrong before —
 * a float estimate of one code path, extrapolated to both.
 *
 * Everything here is bigint and mirrors the Solidity line for line:
 * `TickMath.getSqrtPriceAtTick`, `LiquidityAmounts.getLiquidityForAmount0/1`,
 * and `SqrtPriceMath.getAmount0Delta/getAmount1Delta` with `roundUp = true`,
 * which is what the pool charges when liquidity is added. The port is checked
 * against the real libraries in `tests/liquidity-math-parity.test.ts` using a
 * table generated from Solidity.
 */

const Q96 = 1n << 96n
const MAX_UINT128 = (1n << 128n) - 1n
const MAX_UINT256 = (1n << 256n) - 1n

export const TICK_MATH_MAX_TICK = 887272n

/** Magic constants from TickMath, indexed by the bit of `absTick` they gate. */
const TICK_RATIOS: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
]

/** `TickMath.getSqrtPriceAtTick`. Throws outside the representable range. */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) throw new Error('tick must be an integer')
  const t = BigInt(tick)
  const absTick = t < 0n ? -t : t
  if (absTick > TICK_MATH_MAX_TICK) throw new Error('tick out of TickMath range')

  let ratio = (absTick & 0x1n) !== 0n ? TICK_RATIOS[0]! : 1n << 128n
  for (let i = 1; i < TICK_RATIOS.length; i++) {
    if ((absTick & (1n << BigInt(i))) !== 0n) {
      ratio = (ratio * TICK_RATIOS[i]!) >> 128n
    }
  }
  if (t > 0n) ratio = MAX_UINT256 / ratio

  // Round the Q128.128 ratio up into a Q64.96 sqrt price, as Solidity does.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

function mulDivRoundingUp(a: bigint, b: bigint, d: bigint): bigint {
  const product = a * b
  return product / d + (product % d === 0n ? 0n : 1n)
}

function divRoundingUp(a: bigint, b: bigint): bigint {
  return a / b + (a % b === 0n ? 0n : 1n)
}

function sortSqrt(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b]
}

function toUint128(value: bigint): bigint {
  if (value > MAX_UINT128) throw new Error('liquidity overflows uint128')
  return value
}

/** `LiquidityAmounts.getLiquidityForAmount0`. */
export function getLiquidityForAmount0(
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
): bigint {
  const [lo, hi] = sortSqrt(sqrtA, sqrtB)
  const intermediate = (lo * hi) / Q96
  return toUint128((amount0 * intermediate) / (hi - lo))
}

/** `LiquidityAmounts.getLiquidityForAmount1`. */
export function getLiquidityForAmount1(
  sqrtA: bigint,
  sqrtB: bigint,
  amount1: bigint,
): bigint {
  const [lo, hi] = sortSqrt(sqrtA, sqrtB)
  return toUint128((amount1 * Q96) / (hi - lo))
}

/** `SqrtPriceMath.getAmount0Delta(..., roundUp: true)` — what the pool charges. */
export function getAmount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sortSqrt(sqrtA, sqrtB)
  if (lo === 0n) throw new Error('sqrt price cannot be zero')
  return divRoundingUp(mulDivRoundingUp(liquidity << 96n, hi - lo, hi), lo)
}

/** `SqrtPriceMath.getAmount1Delta(..., roundUp: true)` — what the pool charges. */
export function getAmount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sortSqrt(sqrtA, sqrtB)
  return mulDivRoundingUp(liquidity, hi - lo, Q96)
}

/** `RwagmiBpsSplit.splitShare` — the last slot absorbs floor-division dust. */
export function splitShare(
  amount: bigint,
  bps: number,
  allocated: bigint,
  isLast: boolean,
): bigint {
  return isLast ? amount - allocated : (amount * BigInt(bps)) / 10_000n
}

/**
 * Exactly how much of `amount` a single position will strand.
 *
 * The locker converts the allocation to a liquidity number, and the pool then
 * charges only what that liquidity is actually worth. Both steps truncate, and
 * the remainder is never refunded — it sits in the locker with no way out.
 *
 * The two orientations take genuinely different code paths, which is the whole
 * reason this is computed rather than modelled: a one-sided B20 position sits
 * above the launch tick when the B20 is currency0 (amount0 maths) and below it
 * when the B20 is currency1 (amount1 maths).
 *
 * A liquidity result of zero means the mint places NOTHING: the launch
 * succeeds, the pool is untradeable, and 100% of the allocation is lost.
 */
export function strandedAmountForPosition(
  tickLower: number,
  tickUpper: number,
  amount: bigint,
  b20IsCurrency0: boolean,
): bigint {
  if (amount <= 0n) return 0n
  const sqrtLower = getSqrtPriceAtTick(tickLower)
  const sqrtUpper = getSqrtPriceAtTick(tickUpper)

  const liquidity = b20IsCurrency0
    ? getLiquidityForAmount0(sqrtLower, sqrtUpper, amount)
    : getLiquidityForAmount1(sqrtLower, sqrtUpper, amount)
  if (liquidity === 0n) return amount

  const consumed = b20IsCurrency0
    ? getAmount0Delta(sqrtLower, sqrtUpper, liquidity)
    : getAmount1Delta(sqrtLower, sqrtUpper, liquidity)

  // The pool rounds the charge UP, so it can consume marginally more than the
  // allocation. That is not stranded supply; it is simply nothing left over.
  return consumed >= amount ? 0n : amount - consumed
}
