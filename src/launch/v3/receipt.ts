import { parseEventLogs, type Address, type Log } from 'viem'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import { rwagmiLpLockerV3Abi } from '../../abi/rwagmi-lp-locker-v3.js'
import { poolIdV3 } from './math.js'
import type { LauncherDeploymentV3, LaunchResultV3 } from './types.js'

/** Every launch in a receipt must have a complete graph from its registered emitters. */
export function parseLaunchV3Receipts(
  receipt: { logs: readonly Log[] },
  deployment: LauncherDeploymentV3,
): LaunchResultV3[] {
  const launcherLogs = receipt.logs.filter(
    (l) => l.address.toLowerCase() === deployment.launcher.toLowerCase(),
  )
  const events = parseEventLogs({
    abi: rwagmiLauncherV3Abi,
    eventName: 'B20LaunchCreatedV3',
    logs: [...launcherLogs],
    strict: true,
  })
  if (events.length === 0) return []
  const tokens = new Set(events.map((event) => event.args.token.toLowerCase()))
  if (tokens.size !== events.length) throw new Error('Duplicate v3 launch event')
  const allPoolEvents = parseEventLogs({
    abi: rwagmiLauncherV3Abi,
    eventName: 'LaunchPoolCreatedV3',
    logs: [...launcherLogs],
    strict: true,
  })
  const allPositions = parseEventLogs({
    abi: rwagmiLpLockerV3Abi,
    eventName: 'LiquidityPlacedV3',
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === deployment.locker.toLowerCase()),
    strict: true,
  })
  if (
    allPoolEvents.some((event) => !tokens.has(event.args.token.toLowerCase())) ||
    allPositions.some((event) => !tokens.has(event.args.token.toLowerCase()))
  )
    throw new Error('Incomplete v3 launch graph')
  const receiptPositionIds = new Set<string>()
  return events.map((event): LaunchResultV3 => {
    const a = event.args
    if (
      a.hook.toLowerCase() !== deployment.hook.toLowerCase() ||
      a.locker.toLowerCase() !== deployment.locker.toLowerCase()
    )
      throw new Error('V3 receipt stack mismatch')
    const poolEvents = allPoolEvents
      .filter((e) => e.args.token.toLowerCase() === a.token.toLowerCase())
      .sort((x, y) => x.args.poolIndex - y.args.poolIndex)
    const positions = allPositions.filter(
      (e) => e.args.token.toLowerCase() === a.token.toLowerCase(),
    )
    if (poolEvents.length !== a.poolCount || a.poolCount < 1 || a.poolCount > 5)
      throw new Error('Incomplete v3 pool graph')
    const ids = new Set<string>(),
      quoteTokens = new Set<string>(),
      positionIds = new Set<string>()
    const pools = poolEvents.map((event, index) => {
      const p = event.args
      const is0 = p.key.currency0.toLowerCase() === a.token.toLowerCase()
      const quote = is0 ? p.key.currency1 : p.key.currency0
      if (
        p.poolIndex !== index ||
        p.key.fee !== 0 ||
        p.key.hooks.toLowerCase() !== a.hook.toLowerCase() ||
        (!is0 && p.key.currency1.toLowerCase() !== a.token.toLowerCase()) ||
        p.key.currency0.toLowerCase() >= p.key.currency1.toLowerCase() ||
        poolIdV3(p.key).toLowerCase() !== p.poolId.toLowerCase() ||
        ids.has(p.poolId.toLowerCase()) ||
        quoteTokens.has(quote.toLowerCase()) ||
        p.allocationBps <= 0 ||
        p.depositedSupply <= 0n ||
        p.depositedSupply + p.lockedRemainder !== p.allocatedSupply
      )
        throw new Error('Invalid v3 pool graph')
      ids.add(p.poolId.toLowerCase())
      quoteTokens.add(quote.toLowerCase())
      const minted = positions
        .filter((e) => e.args.poolId.toLowerCase() === p.poolId.toLowerCase())
        .map((e) => {
          const pos = e.args
          if (
            receiptPositionIds.has(pos.positionId.toString()) ||
            pos.liquidity === 0n ||
            pos.tickLower >= pos.tickUpper
          )
            throw new Error('Invalid v3 position graph')
          positionIds.add(pos.positionId.toString())
          receiptPositionIds.add(pos.positionId.toString())
          return {
            id: pos.positionId,
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidity: pos.liquidity,
          }
        })
      if (minted.length < 1 || minted.length > 7) throw new Error('Incomplete v3 position graph')
      return {
        poolId: p.poolId,
        index,
        key: p.key,
        pairedToken: quote as Address,
        allocationBps: p.allocationBps,
        allocatedSupply: p.allocatedSupply,
        depositedSupply: p.depositedSupply,
        lockedRemainder: p.lockedRemainder,
        startingTick: p.startingTick,
        fee: p.fee,
        positions: minted,
      }
    })
    if (
      !ids.has(a.primaryPoolId.toLowerCase()) ||
      positions.length !== positionIds.size ||
      positionIds.size > 25 ||
      pools.reduce((s, p) => s + p.allocationBps, 0) !== 10000 ||
      pools.reduce((s, p) => s + p.allocatedSupply, 0n) !== a.liquiditySupply ||
      a.liquiditySupply + a.extensionSupply !== a.totalSupply
    )
      throw new Error('Incomplete v3 launch graph')
    return {
      version: 3,
      token: a.token,
      creator: a.creator,
      tokenAdmin: a.tokenAdmin,
      name: a.name,
      symbol: a.symbol,
      decimals: a.decimals,
      adminMode: a.adminMode === 0 ? 'immutable' : 'admin',
      hook: a.hook,
      locker: a.locker,
      primaryPoolId: a.primaryPoolId,
      totalSupply: a.totalSupply,
      liquiditySupply: a.liquiditySupply,
      extensionSupply: a.extensionSupply,
      launchTimestamp: a.launchTimestamp,
      rewardConfigurationHash: a.rewardConfigurationHash,
      pools,
    }
  })
}

/** Single-launch convenience API. Call the plural parser for batched transactions. */
export function parseLaunchV3Receipt(
  receipt: { logs: readonly Log[] },
  deployment: LauncherDeploymentV3,
): LaunchResultV3 | null {
  const launches = parseLaunchV3Receipts(receipt, deployment)
  if (launches.length > 1) throw new Error('Ambiguous v3 launch receipt')
  return launches[0] ?? null
}
