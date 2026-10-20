import { type Abi, type Address } from 'viem'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import { rwagmiEthDevBuyV3Abi } from '../../abi/rwagmi-eth-dev-buy-v3.js'
import { buildLaunchV3Config, type BuildLaunchV3Args } from './config.js'
import type { ReadClient } from '../../client.js'
const SENTINEL = (1n << 128n) - 1n
/** eth_call only: obtain output by reverting the complete launch at its min-out check. */
export async function quoteLaunchDevBuyV3(
  client: ReadClient,
  account: Address,
  args: BuildLaunchV3Args,
): Promise<bigint> {
  if (!args.draft.devBuy) throw new Error('Select a creator buy before quoting')
  const config = buildLaunchV3Config({
    ...args,
    draft: { ...args.draft, devBuy: { ...args.draft.devBuy, minimumOut: SENTINEL } },
  })
  try {
    await client.simulateContract({
      account,
      address: args.deployment.launcher,
      abi: [...rwagmiLauncherV3Abi, ...rwagmiEthDevBuyV3Abi] as Abi,
      functionName: 'launchB20',
      args: [config],
      value: config.extensions.reduce((s, e) => s + e.msgValue, 0n),
    })
  } catch (error) {
    const seen = new Set<unknown>()
    let current: unknown = error
    while (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current)
      const e = current as { data?: { errorName?: string; args?: unknown[] }; cause?: unknown }
      if (
        e.data?.errorName === 'Slippage' &&
        e.data.args?.[0] === SENTINEL &&
        typeof e.data.args[1] === 'bigint'
      ) {
        if (e.data.args[1] <= 0n) throw new Error('Creator buy produces no tokens')
        return e.data.args[1]
      }
      current = e.cause
    }
    throw error
  }
  throw new Error('Creator buy sentinel unexpectedly succeeded')
}
