// GENERATED from the real Solidity libraries, not hand-written.
//
// Produced by running TickMath.getSqrtPriceAtTick, LiquidityAmounts, and
// SqrtPriceMath (roundUp: true) under base-forge and transcribing the output.
// The TS ports in src/launch/liquidity-math.ts must reproduce every row
// exactly; if a library is ever upgraded, regenerate rather than adjust.

export const SQRT_PRICE_AT_TICK: readonly (readonly [number, bigint])[] = [
  [0, 79228162514264337593543950336n],
  [1, 79232123823359799118286999568n],
  [-1, 79224201403219477170569942574n],
  [200, 80024378775772204256025656563n],
  [-200, 78439868342809377387252074393n],
  [887272, 1461446703485210103287273052203988822378723970342n],
  [-887272, 4295128739n],
  [887200, 1456195216270955103206513029158776779468408838535n],
  [-887200, 4310618292n],
  [-458400, 8817545854113536099n],
  [-230400, 787149618249685149291181n],
  [110400, 19772667650167597865196908170137n],
  [-650000, 609557393575371n],
  [650000, 10297802637694577668861263540024626515634267n],
  [-12345, 42739035517269358503607398648n],
  [54321, 1197805042314979906427636647812n],
]

export interface LiquidityRow {
  tickLower: number
  tickUpper: number
  amount: bigint
  b20IsCurrency0: boolean
  /** null when the Solidity path reverts (liquidity overflows uint128). */
  liquidity: bigint | null
  consumed: bigint | null
}

export const LIQUIDITY_ROWS: readonly LiquidityRow[] = [
  { tickLower: -458400, tickUpper: -348000, amount: 100000000000000000000000000000n, b20IsCurrency0: true, liquidity: 11174081553550302110n, consumed: 99999999999690802560126544779n },
  { tickLower: -458400, tickUpper: -348000, amount: 1000000000000000000000000n, b20IsCurrency0: true, liquidity: 111740815535503n, consumed: 999999999996907836771429n },
  { tickLower: -458400, tickUpper: -348000, amount: 100000000000000000000n, b20IsCurrency0: true, liquidity: 11174081553n, consumed: 99999999994765994134n },
  { tickLower: -650000, tickUpper: -539600, amount: 1000000000000000000000000n, b20IsCurrency0: true, liquidity: 7721990610n, consumed: 999655951464743939675664n },
  { tickLower: -650000, tickUpper: -539600, amount: 100000000000000000000n, b20IsCurrency0: true, liquidity: 772199n, consumed: 99965587249674706025n },
  { tickLower: -800000, tickUpper: -689600, amount: 1000000000000000000000000n, b20IsCurrency0: true, liquidity: 0n, consumed: 0n },
  { tickLower: 348000, tickUpper: 458400, amount: 100000000000000000000000000000n, b20IsCurrency0: false, liquidity: 11174081553584852084n, consumed: 99999999999999999999676187920n },
  { tickLower: 348000, tickUpper: 458400, amount: 1000000000000000000000000n, b20IsCurrency0: false, liquidity: 111740815535848n, consumed: 999999999999995338853048n },
  { tickLower: 348000, tickUpper: 458400, amount: 100000000000000000000n, b20IsCurrency0: false, liquidity: 11174081553n, consumed: 99999999994765994134n },
  { tickLower: 776800, tickUpper: 887200, amount: 100000000000000000000000000000n, b20IsCurrency0: false, liquidity: 5462653796n, consumed: 99999999989102950217027572068n },
  { tickLower: 776800, tickUpper: 887200, amount: 100000000000000000000n, b20IsCurrency0: false, liquidity: 5n, consumed: 91530603735429319359n },
  { tickLower: 539600, tickUpper: 650000, amount: 100000000000000000000n, b20IsCurrency0: false, liquidity: 772464n, consumed: 99999893018810957782n },
]
