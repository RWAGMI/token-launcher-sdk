import { getAddress, type Address } from 'viem'

/** A Uniswap v4 `PoolKey`: currencies sorted by address, fee, tick spacing and hook. */
export interface V4PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export interface LaunchedPoolKeyInput {
  token: Address
  pairedToken: Address
  lpFee: number
  tickSpacing: number
  hook: Address
}

/** The pool key a launch creates for `token` against `pairedToken`. */
export function buildPoolKey(input: LaunchedPoolKeyInput): V4PoolKey {
  const token = getAddress(input.token)
  const pairedToken = getAddress(input.pairedToken)
  const [currency0, currency1] =
    token.toLowerCase() < pairedToken.toLowerCase() ? [token, pairedToken] : [pairedToken, token]
  return {
    currency0,
    currency1,
    fee: input.lpFee,
    tickSpacing: input.tickSpacing,
    hooks: getAddress(input.hook),
  }
}
