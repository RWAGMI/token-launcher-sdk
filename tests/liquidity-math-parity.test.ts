import { describe, expect, it } from 'vitest'
import {
  getSqrtPriceAtTick,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getAmount0Delta,
  getAmount1Delta,
  strandedAmountForPosition,
} from '../src/launch/liquidity-math.js'
import { LIQUIDITY_ROWS, SQRT_PRICE_AT_TICK } from './fixtures/solidity-liquidity-table.js'

/**
 * The launch guard is only as trustworthy as its claim to reproduce Solidity.
 * These compare the TS ports against a table generated from the real
 * TickMath / LiquidityAmounts / SqrtPriceMath under base-forge.
 */
describe('parity with the deployed Solidity maths', () => {
  it('reproduces TickMath.getSqrtPriceAtTick exactly', () => {
    for (const [tick, expected] of SQRT_PRICE_AT_TICK) {
      expect(getSqrtPriceAtTick(tick), `tick ${tick}`).toBe(expected)
    }
  })

  it('rejects ticks outside the representable range, as Solidity does', () => {
    expect(() => getSqrtPriceAtTick(887_273)).toThrow(/out of TickMath range/)
    expect(() => getSqrtPriceAtTick(-887_273)).toThrow(/out of TickMath range/)
  })

  it('reproduces liquidity and the amount the pool charges, both orientations', () => {
    for (const row of LIQUIDITY_ROWS) {
      const sqrtLower = getSqrtPriceAtTick(row.tickLower)
      const sqrtUpper = getSqrtPriceAtTick(row.tickUpper)
      const label = `${row.tickLower}..${row.tickUpper} amount=${row.amount} c0=${row.b20IsCurrency0}`

      if (row.liquidity === null) {
        // Solidity reverts on uint128 overflow; the port must refuse too rather
        // than return a number that could never exist on chain.
        const overflowing = () =>
          row.b20IsCurrency0
            ? getLiquidityForAmount0(sqrtLower, sqrtUpper, row.amount)
            : getLiquidityForAmount1(sqrtLower, sqrtUpper, row.amount)
        expect(overflowing, label).toThrow(/uint128/)
        continue
      }

      const liquidity = row.b20IsCurrency0
        ? getLiquidityForAmount0(sqrtLower, sqrtUpper, row.amount)
        : getLiquidityForAmount1(sqrtLower, sqrtUpper, row.amount)
      expect(liquidity, `liquidity ${label}`).toBe(row.liquidity)

      if (liquidity === 0n) {
        expect(row.consumed).toBe(0n)
        continue
      }
      const consumed = row.b20IsCurrency0
        ? getAmount0Delta(sqrtLower, sqrtUpper, liquidity)
        : getAmount1Delta(sqrtLower, sqrtUpper, liquidity)
      expect(consumed, `consumed ${label}`).toBe(row.consumed)
    }
  })

  it('reproduces the audited 8.47% currency1 stranding case', () => {
    // The finding that prompted this module: 100 tokens opened at the floor of
    // the tick range, sorted as currency1, strand 8.469396264570680641 — a case
    // the old midpoint estimate scored at ~9.3e-66 and waved through.
    const stranded = strandedAmountForPosition(776_800, 887_200, 100n * 10n ** 18n, false)
    expect(stranded).toBe(8_469_396_264_570_680_641n)
  })

  it('reports zero liquidity as a total loss, not a rounding error', () => {
    // L == 0 means the mint places nothing: the launch succeeds, the pool is
    // untradeable, and the whole allocation sits in the locker permanently.
    const amount = 10n ** 24n
    expect(strandedAmountForPosition(-800_000, -689_600, amount, true)).toBe(amount)
  })
})
