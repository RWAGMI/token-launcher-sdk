import { describe, expect, it } from 'vitest'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import {
  allocateV3Supply,
  quoteFeeV3,
  decimalRational,
  priceToTickV3,
  priceAtTickV3,
  formatRational,
  poolIdV3,
  buildLaunchV3Config,
  previewLaunchV3,
  prepareLaunchV3,
  parseLaunchV3Receipt,
  parseLaunchV3Receipts,
  prepareClaimQuoteV3,
  prepareRewardRotationV3,
  STATIC_FEE_V3,
  DYNAMIC_FEE_V3,
  validateHookFeeV3,
  rwagmiLauncherV3Abi,
  rwagmiLpLockerV3Abi,
  toTransactionRequest,
  type LaunchDraftV3,
  type LauncherDeploymentV3,
} from '../src/index.js'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const deployment: LauncherDeploymentV3 = {
  version: 3,
  chainId: 84532,
  launcher: a(1),
  hook: a(2),
  locker: a(3),
  startBlock: 1n,
}
const token = a(200)
function draft(): LaunchDraftV3 {
  return {
    name: 'V3 Token',
    symbol: 'V3',
    decimals: 18,
    salt: `0x${'11'.repeat(32)}`,
    liquiditySupply: 1_000_000n * 10n ** 18n,
    creatorRewards: [{ admin: a(4), recipient: a(4), bps: 9000 }],
    adminMode: 'immutable',
    initialAdmin: zeroAddress,
    primaryPair: a(300),
    openingMarketCapUsd: '6000',
    deadline: 2000000000n,
    pools: [300, 100, 400].map((id, i) => ({
      pair: { chainId: 84532, token: a(id), decimals: [8, 6, 18][i]!, symbol: `Q${i}` },
      allocationBps: [4000, 3000, 3000][i]!,
      fee: STATIC_FEE_V3,
      reference: {
        usd: ['250', '1', '3000'][i]!,
        basis: 'raw-token',
        source: 'fixture',
        marketTimestamp: null,
        fetchedAt: '2026-10-17T00:00:00Z',
      },
    })),
  }
}
function event(abi: Abi, name: string, address: Address, args: Record<string, unknown>): Log {
  const item = getAbiItem({ abi, name })
  if (!item || item.type !== 'event') throw new Error('Missing event ABI')
  return {
    address,
    topics: encodeEventTopics({ abi, eventName: name, args }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      item.inputs.filter((i) => !i.indexed),
      item.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]),
    ),
    blockNumber: 10n,
    blockHash: `0x${'12'.repeat(32)}`,
    transactionHash: `0x${'34'.repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  }
}
function receipt(token = a(200), positionOffset = 0n) {
  const d = draft(),
    pools = previewLaunchV3({ draft: d, deployment, predictedToken: token })
  const logs = pools.flatMap((p, i) => [
    event(rwagmiLauncherV3Abi, 'LaunchPoolCreatedV3', deployment.launcher, {
      token,
      poolId: p.poolId,
      poolIndex: i,
      key: p.key,
      allocationBps: p.allocationBps,
      allocatedSupply: p.allocatedSupply,
      depositedSupply: p.depositedSupply,
      lockedRemainder: p.lockedRemainder,
      startingTick: p.startingTick,
      fee: p.fee,
    }),
    event(rwagmiLpLockerV3Abi, 'LiquidityPlacedV3', deployment.locker, {
      token,
      poolId: p.poolId,
      positionId: positionOffset + BigInt(i + 1),
      tickLower: p.positions[0]!.tickLower,
      tickUpper: p.positions[0]!.tickUpper,
      liquidity: 123456n,
    }),
  ])
  logs.push(
    event(rwagmiLauncherV3Abi, 'B20LaunchCreatedV3', deployment.launcher, {
      creator: a(4),
      token,
      tokenAdmin: zeroAddress,
      name: d.name,
      symbol: d.symbol,
      decimals: d.decimals,
      adminMode: 0,
      hook: deployment.hook,
      locker: deployment.locker,
      totalSupply: d.liquiditySupply,
      liquiditySupply: d.liquiditySupply,
      extensionSupply: 0n,
      primaryPoolId: pools.find((p) => p.primary)!.poolId,
      poolCount: 3,
      rewardConfigurationHash: `0x${'00'.repeat(32)}`,
      launchTimestamp: 1800000000n,
    }),
  )
  return { logs }
}

describe('v3 money math', () => {
  it('uses specified quote for precharged cases and actual core quote for the other cases', () => {
    expect(quoteFeeV3(101_000000n, 10000, true, true)).toBe(1_000000n)
    expect(quoteFeeV3(99_000000n, 10000, false, false)).toBe(1_000000n)
    expect(quoteFeeV3(100_000000n, 10000, true, false)).toBe(1_000000n)
    expect(quoteFeeV3(100_000000n, 10000, false, true)).toBe(1_000000n)
    expect(quoteFeeV3(1n, 1, true, true)).toBe(1n)
  })
  it('conserves raw supply with the final remainder and rejects zero allocations', () => {
    expect(allocateV3Supply(101n, [3333, 3333, 3334])).toEqual([33n, 33n, 35n])
    expect(() => allocateV3Supply(2n, [3333, 3333, 3334])).toThrow()
  })
  it.each([6, 8, 18])('handles %i quote decimals without Number conversion', (decimals) => {
    const tick = priceToTickV3(decimalRational('0.000000123456789123456789'), 18, decimals)
    const price = priceAtTickV3(tick, 18, decimals)
    const requested = decimalRational('0.000000123456789123456789')
    expect(price.numerator * requested.denominator <= requested.numerator * price.denominator).toBe(
      true,
    )
    expect(Math.abs(tick % 200)).toBe(0)
    expect(formatRational(price, 36)).not.toBe('0')
  })
  it('rejects bad decimals, exponents and fee caps', () => {
    expect(() => decimalRational('1e9999')).toThrow()
    expect(() => priceToTickV3(decimalRational('1'), 18, NaN)).toThrow()
    expect(() => quoteFeeV3(1n, 100001, true, true)).toThrow()
  })
})

describe('v3 configuration and transactions', () => {
  it('sorts pairs, preserves primary selection and applies a common USD market cap across decimals', () => {
    const d = draft(),
      args = { draft: d, deployment, predictedToken: token }
    const c = buildLaunchV3Config(args),
      pools = previewLaunchV3(args)
    expect(c.pools.map((p) => p.pairedToken.toLowerCase())).toEqual([a(100), a(300), a(400)])
    expect(c.primaryPoolIndex).toBe(1)
    pools.forEach((p) => {
      const ref = d.pools.find(
        (x) => x.pair.token.toLowerCase() === p.pairedToken.toLowerCase(),
      )!.reference!
      const cap = Number(p.openingPrice) * Number(ref.usd) * 1_000_000
      expect(cap).toBeLessThanOrEqual(6000.00001)
      expect(cap).toBeGreaterThan(5879)
      expect(p.key.fee).toBe(0)
      expect(p.poolId).toBe(poolIdV3(p.key))
      expect(p.depositedSupply + p.lockedRemainder).toBe(p.allocatedSupply)
    })
    const plan = prepareLaunchV3(args)
    expect(plan.requiresExplicitConfirm).toBe(true)
    expect(
      decodeFunctionData({ abi: rwagmiLauncherV3Abi, data: toTransactionRequest(plan).data })
        .functionName,
    ).toBe('launchB20')
  })
  it.each(['duplicate', 'missing-decimals', 'allocation', 'rewards', 'advanced', 'chain'] as const)(
    'rejects %s',
    (bad) => {
      const d = draft()
      if (bad === 'duplicate') d.pools = [d.pools[0]!, d.pools[0]!]
      if (bad === 'missing-decimals') d.pools[0]!.pair.decimals = NaN
      if (bad === 'allocation') d.pools[0]!.allocationBps = 3999
      if (bad === 'rewards') d.creatorRewards = [{ admin: a(4), recipient: a(4), bps: 10000 }]
      if (bad === 'advanced') d.pools[0]!.priceQuote = '1'
      if (bad === 'chain') d.pools[0]!.pair.chainId = 8453
      expect(() => buildLaunchV3Config({ draft: d, deployment, predictedToken: token })).toThrow()
    },
  )
  it('prepares bounded quote settlement and explicit slot rotation', () => {
    const claim = prepareClaimQuoteV3(deployment, token, a(100), a(4), [`0x${'01'.repeat(32)}`])
    expect(claim.functionName).toBe('settleAndClaim')
    expect(
      prepareRewardRotationV3(deployment, token, 0, 'recipient', a(5)).requiresExplicitConfirm,
    ).toBe(true)
    expect(() => prepareClaimQuoteV3(deployment, token, a(100), zeroAddress)).toThrow()
  })
  it('rejects dynamic fee settings the hook would reject as inert', () => {
    expect(() => validateHookFeeV3(DYNAMIC_FEE_V3)).not.toThrow()
    const d = DYNAMIC_FEE_V3.dynamicConfig
    for (const bad of [
      { feeControlNumerator: 0 },
      { resetPeriod: 0 },
      { referenceTickFilterPeriod: 0 },
      { referenceTickFilterPeriod: d.resetPeriod },
      { maxLpFee: d.baseFee },
    ]) {
      expect(() =>
        validateHookFeeV3({ ...DYNAMIC_FEE_V3, dynamicConfig: { ...d, ...bad } }),
      ).toThrow()
    }
  })
})

describe('v3 receipt graph', () => {
  it('decodes every pool and position from their authorized emitters', () => {
    const result = parseLaunchV3Receipt(receipt(), deployment)!
    expect(result.pools).toHaveLength(3)
    expect(result.pools[1]!.poolId).toBe(result.primaryPoolId)
  })
  it('rejects missing/duplicate positions, partial graphs and spoofed emitters', () => {
    const r = receipt()
    expect(() => parseLaunchV3Receipt({ logs: r.logs.slice(1) }, deployment)).toThrow()
    expect(() => parseLaunchV3Receipt({ logs: [...r.logs, r.logs[1]!] }, deployment)).toThrow()
    expect(() =>
      parseLaunchV3Receipt(
        { logs: r.logs.map((l, i) => (i === 1 ? { ...l, address: a(999) } : l)) },
        deployment,
      ),
    ).toThrow()
    expect(
      parseLaunchV3Receipt({ logs: r.logs.map((l) => ({ ...l, address: a(999) })) }, deployment),
    ).toBeNull()
  })
  it('decodes every complete launch in a batched receipt while preserving the single-launch API', () => {
    const first = receipt(),
      second = receipt(a(201), 3n)
    const batch = { logs: [...first.logs, ...second.logs] }
    expect(
      parseLaunchV3Receipts(batch, deployment).map((launch) => launch.token.toLowerCase()),
    ).toEqual([a(200), a(201)])
    expect(parseLaunchV3Receipts(first, deployment)).toEqual([
      parseLaunchV3Receipt(first, deployment),
    ])
    expect(parseLaunchV3Receipts({ logs: [] }, deployment)).toEqual([])
    expect(() => parseLaunchV3Receipt(batch, deployment)).toThrow('Ambiguous v3 launch receipt')
  })
  it('rejects a partial or spoofed second launch without returning the first graph', () => {
    const first = receipt(),
      second = receipt(a(201), 3n)
    expect(() =>
      parseLaunchV3Receipts({ logs: [...first.logs, ...second.logs.slice(1)] }, deployment),
    ).toThrow()
    expect(() =>
      parseLaunchV3Receipts(
        {
          logs: [
            ...first.logs,
            ...second.logs.map((log, index) => (index === 1 ? { ...log, address: a(999) } : log)),
          ],
        },
        deployment,
      ),
    ).toThrow()
    expect(() =>
      parseLaunchV3Receipts({ logs: [...first.logs, ...second.logs.slice(0, -1)] }, deployment),
    ).toThrow('Incomplete v3 launch graph')
  })
  it('rejects duplicated token events and reused position IDs across a batch', () => {
    const first = receipt()
    expect(() =>
      parseLaunchV3Receipts(
        { logs: [...first.logs, first.logs[first.logs.length - 1]!] },
        deployment,
      ),
    ).toThrow('Duplicate v3 launch event')
    expect(() =>
      parseLaunchV3Receipts({ logs: [...first.logs, ...receipt(a(201)).logs] }, deployment),
    ).toThrow('Invalid v3 position graph')
  })
})
