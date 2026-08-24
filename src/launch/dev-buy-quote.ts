import {
  type Abi,
  type Address,
  type PublicClient,
} from 'viem'
import { rwagmiEthDevBuyAbi } from '../abi/rwagmi-eth-dev-buy.js'
import { rwagmiLauncherAbi } from '../abi/rwagmi-launcher.js'
import {
  MAX_DEV_BUY_AMOUNT_OUT_MINIMUM,
  buildLaunchConfig,
  type BuildLaunchArgs,
} from './config.js'

const BPS_DENOMINATOR = 10_000

/**
 * Include the extension errors while simulating the launcher so viem can
 * decode the intentionally-triggered DevBuySlippage revert.
 */
const LAUNCH_DEV_BUY_SIMULATION_ABI = [
  ...rwagmiLauncherAbi,
  ...rwagmiEthDevBuyAbi,
] as unknown as Abi

/**
 * Apply a maximum slippage tolerance to an exact creator-buy quote.
 * The result is always a positive uint128 value suitable for DevBuyConfig.
 */
export function minimumOutForSlippage(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut <= 0n) throw new Error('dev buy quoted output must be greater than zero')
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= BPS_DENOMINATOR
  ) {
    throw new Error('dev buy slippage must be an integer from 0 to 9999 bps')
  }

  const calculatedMinimum =
    (amountOut * BigInt(BPS_DENOMINATOR - slippageBps)) / BigInt(BPS_DENOMINATOR)
  const minimumOut = calculatedMinimum > 0n ? calculatedMinimum : 1n
  if (minimumOut > MAX_DEV_BUY_AMOUNT_OUT_MINIMUM) {
    throw new Error('dev buy minimum output exceeds uint128')
  }
  return minimumOut
}

/**
 * Quote the exact creator-buy output against the not-yet-created launch pool.
 *
 * The helper simulates the complete launch with uint128.max as the minimum
 * output. A real v4 swap cannot return that sentinel through BalanceDelta, so
 * RwagmiEthDevBuy intentionally reverts with DevBuySlippage(minimum, actual).
 * Decoding `actual` gives the output from the same pool initialization,
 * liquidity curve, LP fee, and extension path the wallet will later sign.
 */
export async function quoteLaunchDevBuy({
  client,
  account,
  args,
}: {
  client: PublicClient
  account: Address
  args: BuildLaunchArgs
}): Promise<bigint> {
  if ((args.draft.devBuyEth ?? 0n) <= 0n) {
    throw new Error('dev buy ETH must be greater than zero to quote')
  }

  const config = buildLaunchConfig({
    ...args,
    draft: {
      ...args.draft,
      devBuyAmountOutMinimum: MAX_DEV_BUY_AMOUNT_OUT_MINIMUM,
    },
  })
  const value = config.extensionConfigs.reduce((sum, extension) => sum + extension.msgValue, 0n)

  try {
    await client.simulateContract({
      account,
      address: args.addresses.launcher,
      abi: LAUNCH_DEV_BUY_SIMULATION_ABI,
      functionName: 'launchB20',
      args: [config],
      value,
    })
  } catch (error) {
    const actualOut = devBuyActualOutFromSentinel(error)
    if (actualOut === null) throw error
    if (actualOut <= 0n) throw new Error('dev buy simulation returned zero tokens')
    if (actualOut > MAX_DEV_BUY_AMOUNT_OUT_MINIMUM) {
      throw new Error('dev buy quoted output exceeds uint128')
    }
    return actualOut
  }

  throw new Error('dev buy sentinel simulation unexpectedly succeeded')
}

function devBuyActualOutFromSentinel(error: unknown): bigint | null {
  const seen = new Set<object>()
  let current = error

  while (isObject(current) && !seen.has(current)) {
    seen.add(current)
    const data = current.data
    if (
      isObject(data) &&
      data.errorName === 'DevBuySlippage' &&
      Array.isArray(data.args) &&
      data.args.length === 2
    ) {
      const [minimumOut, actualOut] = data.args
      if (
        minimumOut === MAX_DEV_BUY_AMOUNT_OUT_MINIMUM &&
        typeof actualOut === 'bigint'
      ) {
        return actualOut
      }
    }
    current = current.cause
  }

  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
