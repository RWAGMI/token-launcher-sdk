import { describe, expect, it } from 'vitest'
import {
  MAX_STRANDED_PPB,
  alignedStartingPrice,
  launchLiquidityCurve,
  strandedSupplyForCurve,
  validateLiquidityCurve,
  LAUNCH_TICK_SPACING,
} from '../src/index.js'

/**
 * `placeLiquidity` can silently fail to deposit part of the launch supply: the
 * v4 mint truncates, and the shortfall stays in the locker with no way to
 * recover it. At the extreme the mint places zero liquidity — an untradeable
 * pool holding none of its supply. The locker and launcher are deployed and
 * cannot be changed, so the SDK is the only place this can be caught.
 */
describe('liquidity precision guard', () => {
  /** RWAGMI's default: 100,000,000,000 tokens at 18 decimals. */
  const DEFAULT_SUPPLY = 10n ** 11n * 10n ** 18n

  const curveFor = (price: number, pairDecimals: number, b20IsCurrency0 = true) => {
    const { startingTick } = alignedStartingPrice(price, 18, pairDecimals, LAUNCH_TICK_SPACING)
    const actualStartTick = b20IsCurrency0 ? startingTick : -startingTick
    return {
      actualStartTick,
      curve: launchLiquidityCurve(startingTick, LAUNCH_TICK_SPACING, b20IsCurrency0, 'Standard'),
    }
  }

  it('leaves the shipped defaults far inside the limit, both orientations', () => {
    for (const [label, price, dp] of [
      ['WETH', 0.000000000025, 18],
      ['GOOGLc / AAPLc', 0.000000000125, 8],
      ['NVDAc', 0.0000000002, 8],
      ['METAc', 0.000000000075, 8],
      ['COINc', 0.0000000002, 8],
      ['SPCXc', 0.0000000003, 8],
      ['TSLAc', 0.000000000125, 8],
    ] as const) {
      // Orientation is a coin flip per launch: a launch token and a B20 stock
      // share an address prefix and sort against each other on a hash, so both
      // paths ship and both have to hold.
      for (const b20IsCurrency0 of [true, false]) {
        const { actualStartTick, curve } = curveFor(price, dp, b20IsCurrency0)
        const where = `${label} c0=${b20IsCurrency0}`
        expect(
          () =>
            validateLiquidityCurve(
              curve,
              actualStartTick,
              LAUNCH_TICK_SPACING,
              b20IsCurrency0,
              DEFAULT_SUPPLY,
            ),
          where,
        ).not.toThrow()

        const stranded = strandedSupplyForCurve(curve, DEFAULT_SUPPLY, b20IsCurrency0)
        expect(stranded * 1_000_000_000n, where).toBeLessThanOrEqual(
          DEFAULT_SUPPLY * MAX_STRANDED_PPB,
        )
      }
    }
  })

  it('matches what the deployed contracts actually stranded', () => {
    // Base Sepolia, 8-decimal stock pair at the 1.25e-10 default: start tick
    // -458400, Standard curve, 1e11 supply. The real launch stranded 0.309.
    const curve = launchLiquidityCurve(-458_400, LAUNCH_TICK_SPACING, true, 'Standard')
    const stranded = strandedSupplyForCurve(curve, DEFAULT_SUPPLY, true)
    // Exact, not an estimate: 0.309197439873455221 tokens of 1e11.
    expect(stranded).toBe(309_197_439_873_455_221n)
  })

  it('rejects an opening price low enough to strand real supply', () => {
    for (const price of [1e-17, 1e-21, 1e-25]) {
      const { actualStartTick, curve } = curveFor(price, 8)
      expect(
        () =>
          validateLiquidityCurve(curve, actualStartTick, LAUNCH_TICK_SPACING, true, DEFAULT_SUPPLY),
        `price ${price}`,
      ).toThrow(/opening price is too (low|extreme)/)
    }
  })

  it('catches the currency1 case the midpoint estimate waved through', () => {
    // The M-01 regression. 100 tokens opened at the floor of the tick range and
    // sorted as currency1 strand 8.47% of supply. The old float estimate scored
    // this at ~9.3e-66 because it only modelled the amount0 path, which is
    // inert once the ticks mirror positive.
    const smallSupply = 100n * 10n ** 18n
    const curve = {
      tickLower: [776_800],
      tickUpper: [887_200],
      positionBps: [10_000],
    }
    const stranded = strandedSupplyForCurve(curve, smallSupply, false)
    expect(stranded).toBe(8_469_396_264_570_680_641n)
    expect(() =>
      validateLiquidityCurve(curve, 887_200, LAUNCH_TICK_SPACING, false, smallSupply),
    ).toThrow(/strand ~8\.4[0-9]*% of the launch supply/)
  })

  it('reports a total loss where the mint would place zero liquidity', () => {
    // L == 0: the launch succeeds, the pool is untradeable, and 100% of supply
    // sits in the locker permanently.
    const curve = launchLiquidityCurve(-880_000, LAUNCH_TICK_SPACING, true, 'Standard')
    const supply = 10n ** 24n
    expect(strandedSupplyForCurve(curve, supply, true)).toBe(supply)
  })

  it('is supply-independent in the amount0 path and supply-dependent in amount1', () => {
    // Why the guard has to be handed the supply rather than deriving a fraction
    // from geometry alone. In the amount0 path the relative loss really is a
    // pure function of the range, which is what the old estimate assumed and
    // got right:
    const c0Curve = launchLiquidityCurve(-650_000, LAUNCH_TICK_SPACING, true, 'Standard')
    const c0Ppb = (supply: bigint) =>
      (strandedSupplyForCurve(c0Curve, supply, true) * 1_000_000_000n) / supply
    expect(c0Ppb(10n ** 29n)).toBe(c0Ppb(10n ** 24n))

    // In the amount1 path liquidity scales with the allocation, so the relative
    // truncation loss grows as the launch shrinks. The same range is harmless
    // at the default supply and severe at a small one — a difference no
    // geometry-only model can express.
    const c1Curve = { tickLower: [776_800], tickUpper: [887_200], positionBps: [10_000] }
    const c1Ppb = (supply: bigint) =>
      (strandedSupplyForCurve(c1Curve, supply, false) * 1_000_000_000n) / supply
    expect(c1Ppb(10n ** 29n)).toBe(0n)
    expect(c1Ppb(100n * 10n ** 18n)).toBeGreaterThan(80_000_000n)
  })

  it('rejects a mint that would revert on liquidity overflow', () => {
    // Deep in the currency1 orientation the required liquidity exceeds uint128
    // and the on-chain mint reverts. That is a failed launch, not stranding, so
    // it gets its own message rather than a misleading percentage.
    const curve = { tickLower: [-650_000], tickUpper: [-539_600], positionBps: [10_000] }
    expect(() =>
      validateLiquidityCurve(curve, -539_600, LAUNCH_TICK_SPACING, false, 10n ** 29n),
    ).toThrow(/too extreme|revert/)
  })

  it('an 8-decimal pair sits closer to the limit than an 18-decimal one', () => {
    const weth = curveFor(0.000000000025, 18).actualStartTick
    const stock = curveFor(0.000000000025, 8).actualStartTick
    expect(weth - stock).toBeGreaterThan(200_000)
  })
})
