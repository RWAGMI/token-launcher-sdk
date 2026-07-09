import { parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { rwagmiLauncherAbi } from '../abi/rwagmi-launcher.js'

/** Decoded result of a successful launch, ready for the success screen. */
export interface LaunchResult {
  token: Address
  tokenAdmin: Address
  name: string
  symbol: string
  startingTick: number
  hook: Address
  poolId: Hex
  lpFee: number
  tickSpacing: number
  pairedToken: Address
  locker: Address
  mevModule: Address
  poolSupply: bigint
  extensionsSupply: bigint
  adminMode: 'immutable' | 'admin'
  extensions: readonly Address[]
}

/**
 * Extract the B20TokenCreated event from a launch receipt's logs. Returns null
 * (rather than throwing) when the event is absent, so the UI can show a soft
 * "couldn't read the launch result" state instead of crashing.
 */
export function parseLaunchReceipt(
  receipt: { logs: readonly Log[] },
  launcher?: Address,
): LaunchResult | null {
  const events = parseEventLogs({
    abi: rwagmiLauncherAbi,
    eventName: 'B20TokenCreated',
    logs: receipt.logs as Log[],
  })
  const event = launcher
    ? events.find((e) => e.address.toLowerCase() === launcher.toLowerCase())
    : events[0]
  if (!event) return null

  const a = event.args
  return {
    token: a.tokenAddress,
    tokenAdmin: a.tokenAdmin,
    name: a.tokenName,
    symbol: a.tokenSymbol,
    startingTick: a.startingTick,
    hook: a.poolHook,
    poolId: a.poolId,
    lpFee: a.lpFee,
    tickSpacing: a.tickSpacing,
    pairedToken: a.pairedToken,
    locker: a.locker,
    mevModule: a.mevModule,
    poolSupply: a.poolSupply,
    extensionsSupply: a.extensionsSupply,
    adminMode: Number(a.adminMode) === 0 ? 'immutable' : 'admin',
    extensions: a.extensions,
  }
}
