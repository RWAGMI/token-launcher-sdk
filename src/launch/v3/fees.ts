import {
  erc20Abi,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { rwagmiLpLockerV3Abi } from '../../abi/rwagmi-lp-locker-v3.js'
import { rwagmiHookV3Abi } from '../../abi/rwagmi-hook-v3.js'
import { rwagmiLauncherV3Abi } from '../../abi/rwagmi-launcher-v3.js'
import { prepareWrite } from '../../tx-plan.js'
import type { LauncherDeploymentV3, LaunchPairV3 } from './types.js'
import type { ReadClient } from '../../client.js'

function nonzero(a: Address) {
  if (!isAddress(a, { strict: false }) || a.toLowerCase() === zeroAddress)
    throw new Error('A nonzero address is required')
  return getAddress(a)
}
/** All reads share one block, so settlement cannot make the displayed claim double-count. */
export async function readLaunchFeesV3(
  client: ReadClient,
  deployment: LauncherDeploymentV3,
  token: Address,
  recipient: Address,
) {
  const blockNumber = await client.getBlockNumber()
  const launch = await client.readContract({
    address: deployment.locker,
    abi: rwagmiLpLockerV3Abi,
    functionName: 'launchInfo',
    args: [token],
    blockNumber,
  })
  if (!launch.complete || launch.poolIds.length < 1 || launch.poolIds.length > 5)
    throw new Error('V3 launch is not complete')
  const pools = await Promise.all(
    launch.poolIds.map(async (poolId) => {
      const [record, pending, currentFee] = await Promise.all([
        client.readContract({
          address: deployment.locker,
          abi: rwagmiLpLockerV3Abi,
          functionName: 'poolRecord',
          args: [poolId],
          blockNumber,
        }),
        client.readContract({
          address: deployment.locker,
          abi: rwagmiLpLockerV3Abi,
          functionName: 'pendingQuote',
          args: [poolId, recipient],
          blockNumber,
        }),
        client.readContract({
          address: deployment.hook,
          abi: rwagmiHookV3Abi,
          functionName: 'currentFee',
          args: [poolId],
          blockNumber,
        }),
      ])
      if (record.token.toLowerCase() !== token.toLowerCase())
        throw new Error('Pool belongs to a different token')
      return { poolId, record, pending, currentFee }
    }),
  )
  const quotes = [...new Set(pools.map((p) => p.record.quote.toLowerCase() as Address))]
  const currencies = await Promise.all(
    quotes.map(async (currency) => {
      const [claimable, decimals, symbol, accounting] = await Promise.all([
        client.readContract({
          address: deployment.locker,
          abi: rwagmiLpLockerV3Abi,
          functionName: 'claimableQuote',
          args: [recipient, currency],
          blockNumber,
        }),
        client.readContract({
          address: currency,
          abi: erc20Abi,
          functionName: 'decimals',
          blockNumber,
        }),
        client.readContract({
          address: currency,
          abi: erc20Abi,
          functionName: 'symbol',
          blockNumber,
        }),
        client.readContract({
          address: deployment.locker,
          abi: rwagmiLpLockerV3Abi,
          functionName: 'currencyAccounting',
          args: [currency],
          blockNumber,
        }),
      ])
      return {
        currency,
        decimals,
        symbol,
        claimable,
        accounting,
        pending: pools
          .filter((p) => p.record.quote.toLowerCase() === currency)
          .reduce((s, p) => s + p.pending, 0n),
      }
    }),
  )
  return { blockNumber, launch, pools, currencies }
}

export async function preflightLaunchV3(
  client: ReadClient,
  deployment: LauncherDeploymentV3,
  pairs: readonly LaunchPairV3[],
) {
  if ((await client.getChainId()) !== deployment.chainId)
    throw new Error('RPC chain does not match the v3 deployment')
  const blockNumber = await client.getBlockNumber()
  const read = { address: deployment.launcher, abi: rwagmiLauncherV3Abi, blockNumber } as const
  const [hook, locker, deprecated] = await Promise.all([
    client.readContract({ ...read, functionName: 'hook' }),
    client.readContract({ ...read, functionName: 'locker' }),
    client.readContract({ ...read, functionName: 'deprecated' }),
  ])
  if (
    deprecated ||
    hook.toLowerCase() !== deployment.hook.toLowerCase() ||
    locker.toLowerCase() !== deployment.locker.toLowerCase()
  )
    throw new Error('V3 launcher is unavailable or its configuration changed')
  await Promise.all(
    pairs.map(async (pair) => {
      if (pair.chainId !== deployment.chainId) throw new Error('Paired asset chain mismatch')
      const [allowed, decimals] = await Promise.all([
        client.readContract({ ...read, functionName: 'pairedTokenEnabled', args: [pair.token] }),
        client.readContract({
          address: pair.token,
          abi: erc20Abi,
          functionName: 'decimals',
          blockNumber,
        }),
      ])
      if (!allowed || decimals !== pair.decimals)
        throw new Error(`Refresh ${pair.symbol}: the allowlist or decimals changed`)
    }),
  )
  return blockNumber
}

export function prepareClaimQuoteV3(
  deployment: LauncherDeploymentV3,
  token: Address,
  currency: Address,
  to: Address,
  poolIds: readonly Hex[] = [],
) {
  nonzero(currency)
  nonzero(to)
  if (poolIds.length > 25 || new Set(poolIds.map((p) => p.toLowerCase())).size !== poolIds.length)
    throw new Error('Invalid claim pool list')
  return prepareWrite({
    kind: 'claim-quote-v3',
    label: 'Claim paired-asset rewards',
    chainId: deployment.chainId,
    subjectToken: token,
    to: deployment.locker,
    abi: rwagmiLpLockerV3Abi,
    functionName: poolIds.length ? 'settleAndClaim' : 'claimQuote',
    args: poolIds.length ? [poolIds, currency, to] : [currency, to],
    riskLevel: 'low',
    warnings: [
      'Includes settled rewards in this currency from all your launches using this locker.',
    ],
  })
}
export function prepareRewardRotationV3(
  deployment: LauncherDeploymentV3,
  token: Address,
  slot: number,
  kind: 'recipient' | 'admin',
  next: Address,
) {
  nonzero(next)
  if (!Number.isInteger(slot) || slot < 0 || slot > 6) throw new Error('Invalid reward slot')
  return prepareWrite({
    kind: `rotate-reward-${kind}-v3`,
    label: `Change reward ${kind}`,
    chainId: deployment.chainId,
    subjectToken: token,
    to: deployment.locker,
    abi: rwagmiLpLockerV3Abi,
    functionName: kind === 'recipient' ? 'updateRewardRecipient' : 'updateRewardAdmin',
    args: [token, BigInt(slot), next],
    riskLevel: 'critical',
    warnings:
      kind === 'recipient'
        ? [
            'Unsettled rewards follow the new recipient. Already credited rewards remain with the previous recipient.',
          ]
        : ['The new admin controls future changes to this reward slot.'],
  })
}
