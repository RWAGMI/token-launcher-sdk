import { describe, expect, it } from 'vitest'
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_LAUNCH_LP_FEE,
  MAX_DEV_BUY_AMOUNT_OUT_MINIMUM,
  POOL_POSITIONS,
  alignTick,
  alignedStartingPrice,
  buildLaunchConfig,
  encodeDevBuyData,
  formatLpFeePercent,
  launchTickRange,
  launchLiquidityCurve,
  maxUsableTick,
  minUsableTick,
  parseLpFeePercent,
  parseLaunchReceipt,
  prepareClaimLaunchRewards,
  prepareCollectLaunchRewards,
  prepareLaunchB20,
  prepareUpdateLaunchRewardRecipient,
  priceToStartingTick,
  resolveLauncherAddresses,
  resolveRwagmiFeeConfig,
  rwagmiLauncherAbi,
  type BuildLaunchArgs,
  type LaunchDraft,
  type LaunchPairConfig,
} from '../src/index.js'
import { b20Abi } from '../src/abi/b20.js'

const LAUNCHER = '0x1111111111111111111111111111111111111111' as const
const HOOK = '0x2222222222222222222222222222222222222222' as const
const LOCKER = '0x3333333333333333333333333333333333333333' as const
const MEV = '0x6666666666666666666666666666666666666666' as const
const DEVBUY = '0x7777777777777777777777777777777777777777' as const
const CREATOR = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as const
const RWAGMI_R = '0x4444444444444444444444444444444444444444' as const
const RWAGMI_A = '0x5555555555555555555555555555555555555555' as const
const PAIRED = '0x4200000000000000000000000000000000000006' as const // WETH

describe('ticks', () => {
  it('price 1 maps to tick 0; price 1.0001 to tick 1', () => {
    expect(priceToStartingTick(1)).toBe(0)
    expect(priceToStartingTick(1.0001)).toBe(1)
  })

  it('reports the execution price after aligning down to launch tick spacing', () => {
    const aligned = alignedStartingPrice(0.0001, 18, 18, 200)

    expect(Math.abs(aligned.startingTick % 200)).toBe(0)
    expect(aligned.pairedPerB20).toBeLessThanOrEqual(0.0001)
    expect(aligned.pairedPerB20).toBeGreaterThan(0.000098)
  })

  it('usable ticks align to spacing', () => {
    expect(maxUsableTick(200)).toBe(887_200)
    expect(minUsableTick(200)).toBe(-887_200)
    expect(alignTick(887_001, 200)).toBe(887_000)
    expect(alignTick(887_001, 200, true)).toBe(887_200)
  })

  it('one-sided range sits above the start when B20 is currency0', () => {
    const r = launchTickRange(0, 200, true)
    expect(r.tickLower).toBe(0)
    expect(r.tickUpper).toBe(887_200)
    expect(r.tickLower % 200).toBe(0)
  })

  it('one-sided range sits below the start when B20 is currency1', () => {
    const r = launchTickRange(0, 200, false)
    expect(r.tickLower).toBe(-887_200)
    expect(r.tickUpper).toBe(0)
    expect(r.tickUpper % 200 === 0).toBe(true)
  })

  it('exposes the built-in pool position presets', () => {
    expect(POOL_POSITIONS.Standard).toEqual([
      { tickLower: -230_400, tickUpper: -120_000, positionBps: 10_000 },
    ])
    expect(POOL_POSITIONS.Project).toEqual([
      { tickLower: -230_400, tickUpper: -214_000, positionBps: 1_000 },
      { tickLower: -214_000, tickUpper: -155_000, positionBps: 5_000 },
      { tickLower: -202_000, tickUpper: -155_000, positionBps: 1_500 },
      { tickLower: -155_000, tickUpper: -120_000, positionBps: 2_000 },
      { tickLower: -141_000, tickUpper: -120_000, positionBps: 500 },
    ])
  })

  it('parses and formats launch LP fees as percentages', () => {
    expect(parseLpFeePercent('1')).toBe(10_000)
    expect(parseLpFeePercent('1.25')).toBe(12_500)
    expect(formatLpFeePercent(12_500)).toBe('1.25%')
    expect(formatLpFeePercent(100_000)).toBe('10.00%')
  })

  it('shifts presets to the launch tick and mirrors them when B20 is currency1', () => {
    expect(launchLiquidityCurve(0, 200, true, 'Project')).toEqual({
      tickLower: [0, 16_400, 28_400, 75_400, 89_400],
      tickUpper: [16_400, 75_400, 75_400, 110_400, 110_400],
      positionBps: [1_000, 5_000, 1_500, 2_000, 500],
    })
    expect(launchLiquidityCurve(0, 200, false, 'Project')).toEqual({
      tickLower: [-16_400, -75_400, -75_400, -110_400, -110_400],
      tickUpper: [0, -16_400, -28_400, -75_400, -89_400],
      positionBps: [1_000, 5_000, 1_500, 2_000, 500],
    })
  })
})

describe('addresses', () => {
  const raw = {
    [BASE_SEPOLIA_CHAIN_ID]: {
      launcher: LAUNCHER,
      hook: HOOK,
      locker: LOCKER,
      mevModule: MEV,
      devBuyExtension: DEVBUY,
    },
  }

  it('returns the stack for a supported chain with full addresses', () => {
    expect(resolveLauncherAddresses(BASE_SEPOLIA_CHAIN_ID, raw)).toEqual({
      launcher: LAUNCHER,
      hook: HOOK,
      locker: LOCKER,
      mevModule: MEV,
      devBuyExtension: DEVBUY,
    })
  })

  it('rejects unsupported chains', () => {
    expect(resolveLauncherAddresses(1, raw)).toBeNull()
  })

  it('rejects when an address is missing or zero', () => {
    expect(resolveLauncherAddresses(BASE_MAINNET_CHAIN_ID, raw)).toBeNull()
    expect(
      resolveLauncherAddresses(BASE_SEPOLIA_CHAIN_ID, {
        [BASE_SEPOLIA_CHAIN_ID]: { launcher: LAUNCHER, hook: HOOK },
      }),
    ).toBeNull()
  })

  it('validates the RWAGMI fee config', () => {
    expect(resolveRwagmiFeeConfig(RWAGMI_R, RWAGMI_A)).toEqual({ recipient: RWAGMI_R, admin: RWAGMI_A })
    expect(resolveRwagmiFeeConfig(undefined, RWAGMI_A)).toBeNull()
    expect(resolveRwagmiFeeConfig(RWAGMI_R, '0x0000000000000000000000000000000000000000')).toBeNull()
  })
})

function draft(overrides: Partial<LaunchDraft> = {}): LaunchDraft {
  return {
    variant: 'asset',
    name: 'RWAGMI Token',
    symbol: 'RWG',
    decimals: 18,
    salt: ('0x' + '11'.repeat(32)) as Hex,
    poolSupply: 1_000_000n * 10n ** 18n,
    creatorRecipient: CREATOR,
    creatorAdmin: CREATOR,
    pairedToken: PAIRED,
    lpFee: DEFAULT_LAUNCH_LP_FEE,
    initialPrice: 1,
    initialAdmin: CREATOR,
    ...overrides,
  }
}

/**
 * The WETH pair as it appears in the curated registry. Tests pin it explicitly
 * so they do not depend on deployed module addresses being configured.
 */
const WETH_PAIR: LaunchPairConfig = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  token: PAIRED,
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  defaultOpeningPrice: '0.000000000025',
  mevModule: MEV,
  supportsEthDevBuy: true,
  riskLabel: 'canonical-weth',
}

/** An 8-decimal B20 stock pair: no dev buy, its own pair-bound module. */
const STOCK_PAIR: LaunchPairConfig = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  token: getAddress('0xb2000000000000000000002d0ba3164cc74f58b7'),
  name: 'Alphabet Inc.',
  symbol: 'GOOGLc',
  decimals: 8,
  defaultOpeningPrice: '0.000000000025',
  mevModule: getAddress('0x00000000000000000000000000000000000f0001'),
  supportsEthDevBuy: false,
  riskLabel: 'admin-controlled-b20-stock',
}

function args(overrides: Partial<BuildLaunchArgs> = {}): BuildLaunchArgs {
  return {
    draft: draft(),
    chainId: BASE_SEPOLIA_CHAIN_ID,
    addresses: { launcher: LAUNCHER, hook: HOOK, locker: LOCKER, devBuyExtension: DEVBUY },
    rwagmiFee: { recipient: RWAGMI_R, admin: RWAGMI_A },
    // predicted < paired (WETH) so B20 sorts as currency0
    predictedToken: '0x0000000000000000000000000000000000000abc',
    pair: WETH_PAIR,
    ...overrides,
  }
}

describe('buildLaunchConfig', () => {
  it('defaults the reward split to 90/10 summing to 10000', () => {
    const c = buildLaunchConfig(args())
    expect(c.lockerConfig.rewardBps).toEqual([9000, 1000])
    expect(c.lockerConfig.rewardBps[0]! + c.lockerConfig.rewardBps[1]!).toBe(10_000)
    expect(c.lockerConfig.rewardRecipients).toEqual([CREATOR, RWAGMI_R])
    expect(c.lockerConfig.positionBps).toEqual([10_000])
    expect(c.lockerConfig.tickLower).toEqual([0])
    expect(c.lockerConfig.tickUpper).toEqual([110_400])
    expect(c.poolConfig.tickIfToken0IsB20).toBe(0)
    expect(c.mevModuleConfig.mevModule).toBe(MEV)
    expect(c.adminMode).toBe(0)
    expect(c.b20Config.initialAdmin).toBe('0x0000000000000000000000000000000000000000')
    expect(c.b20Config.initCalls).toEqual([])
  })

  it('threads contractURI into immutable launch metadata initCalls', () => {
    const c = buildLaunchConfig(
      args({ draft: draft({ contractURI: 'ipfs://metadata' }) }),
    )
    expect(c.b20Config.initCalls).toHaveLength(1)
    const decoded = decodeFunctionData({
      abi: b20Abi,
      data: c.b20Config.initCalls[0]!,
    })
    expect(decoded.functionName).toBe('updateContractURI')
    expect((decoded.args as [string])[0]).toBe('ipfs://metadata')
    expect(c.adminMode).toBe(0)
  })

  it('rejects out-of-range decimals', () => {
    expect(() => buildLaunchConfig(args({ draft: draft({ decimals: 5 }) }))).toThrow(/decimals/)
    expect(() => buildLaunchConfig(args({ draft: draft({ decimals: 19 }) }))).toThrow(/decimals/)
  })

  it('rejects zero pool supply', () => {
    expect(() => buildLaunchConfig(args({ draft: draft({ poolSupply: 0n }) }))).toThrow(/supply/)
  })

  it('rejects non-asset variants', () => {
    expect(() =>
      buildLaunchConfig(args({ draft: draft({ variant: 'stablecoin' as never }) })),
    ).toThrow(/Asset variant only/)
  })

  it('aligns tick ranges to the preset spacing and orients them by sort order', () => {
    const c0 = buildLaunchConfig(args()) // B20 currency0
    expect(c0.poolConfig.tickSpacing).toBe(200)
    expect(c0.lockerConfig.tickLower[0]! % 200).toBe(0)
    expect(c0.lockerConfig.tickUpper[0]! % 200).toBe(0)
    expect(c0.lockerConfig.tickLower[0]).toBe(c0.poolConfig.tickIfToken0IsB20)
    expect(c0.lockerConfig.tickUpper[0]).toBe(110_400)

    const c1 = buildLaunchConfig(
      args({ predictedToken: '0xffffffffffffffffffffffffffffffffffffffff' }),
    ) // B20 currency1
    expect(c1.lockerConfig.tickLower[0]).toBe(-110_400)
    expect(c1.lockerConfig.tickUpper[0]).toBe(0)
  })

  it('defaults to 1% and allows higher static launch fees', () => {
    const defaultConfig = buildLaunchConfig(args({ draft: draft({ lpFee: undefined }) }))
    expect(defaultConfig.poolConfig.lpFee).toBe(10_000)
    expect(defaultConfig.poolConfig.tickSpacing).toBe(200)

    const highFeeConfig = buildLaunchConfig(args({ draft: draft({ lpFee: 50_000 }) }))
    expect(highFeeConfig.poolConfig.lpFee).toBe(50_000)
    expect(highFeeConfig.poolConfig.tickSpacing).toBe(200)
  })

  it('rejects sub-1% launch fees', () => {
    expect(() => buildLaunchConfig(args({ draft: draft({ lpFee: 3_000 }) }))).toThrow(/at least 1.00%/)
  })

  it('builds the overlapping Project pool configuration', () => {
    const c = buildLaunchConfig(args({ draft: draft({ liquidityShape: 'Project' }) }))
    expect(c.lockerConfig.tickLower).toEqual([0, 16_400, 28_400, 75_400, 89_400])
    expect(c.lockerConfig.tickUpper).toEqual([16_400, 75_400, 75_400, 110_400, 110_400])
    expect(c.lockerConfig.positionBps).toEqual([1_000, 5_000, 1_500, 2_000, 500])
  })

  it('converts the initial price into the starting tick', () => {
    const c = buildLaunchConfig(args({ draft: draft({ initialPrice: 1 }) }))
    expect(c.poolConfig.tickIfToken0IsB20).toBe(0)
  })

  it('encodes admin-mode initCalls that mint pool supply to the launcher', () => {
    const c = buildLaunchConfig(
      args({ draft: draft({ adminMode: 'admin', contractURI: 'ipfs://metadata' }) }),
    )
    const uriCall = c.b20Config.initCalls[0]!
    const uri = decodeFunctionData({ abi: b20Abi, data: uriCall })
    expect(uri.functionName).toBe('updateContractURI')
    expect((uri.args as [string])[0]).toBe('ipfs://metadata')
    const mintCall = c.b20Config.initCalls[c.b20Config.initCalls.length - 1]!
    const decoded = decodeFunctionData({ abi: b20Abi, data: mintCall })
    expect(decoded.functionName).toBe('mint')
    expect((decoded.args as [Address, bigint])[0]).toBe(LAUNCHER)
    expect((decoded.args as [Address, bigint])[1]).toBe(draft().poolSupply)
    expect(c.adminMode).toBe(1)
    expect(c.b20Config.initialAdmin).toBe(CREATOR)
  })

  it('prepareLaunchB20 produces a critical plan with the fee disclosure', () => {
    const plan = prepareLaunchB20(args())
    expect(plan.functionName).toBe('launchB20')
    expect(plan.to).toBe(LAUNCHER)
    expect(plan.riskLevel).toBe('critical')
    expect(plan.warnings.join(' ')).toMatch(/10% of the launch LP/i)
  })

  it('takes the paired token, decimals, and auction module from the pair, not the draft', () => {
    const c = buildLaunchConfig(
      args({
        draft: draft({ pairedToken: STOCK_PAIR.token, initialPrice: 0.000000000125 }),
        pair: STOCK_PAIR,
      }),
    )

    expect(c.poolConfig.pairedToken).toBe(STOCK_PAIR.token)
    // The module is the pair's own, never a shared default: the launcher
    // allowlists pairs and modules independently, so a default would let a
    // mismatched combination be built.
    expect(c.mevModuleConfig.mevModule).toBe(STOCK_PAIR.mevModule)
    expect(c.mevModuleConfig.mevModuleData).toBe('0x')
  })

  it('rejects a draft whose paired token disagrees with the selected pair', () => {
    expect(() =>
      buildLaunchConfig(args({ draft: draft({ pairedToken: STOCK_PAIR.token }) })),
    ).toThrow(/does not match the selected pair/)
  })

  it('rejects stale draft decimals left over from an earlier pair selection', () => {
    expect(() =>
      buildLaunchConfig(
        args({
          draft: draft({
            pairedToken: STOCK_PAIR.token,
            pairedDecimals: 18,
            initialPrice: 0.000000000125,
          }),
          pair: STOCK_PAIR,
        }),
      ),
    ).toThrow(/do not match the selected pair/)
  })

  it('rejects a pair registered for a different chain', () => {
    expect(() =>
      buildLaunchConfig(args({ pair: { ...WETH_PAIR, chainId: BASE_MAINNET_CHAIN_ID } })),
    ).toThrow(/registered for chain/)
  })

  it('refuses a creator dev buy on any pair but WETH', () => {
    expect(() =>
      buildLaunchConfig(
        args({
          draft: draft({
            pairedToken: STOCK_PAIR.token,
            initialPrice: 0.000000000125,
            devBuyEth: 1_000_000_000_000_000n,
            devBuyAmountOutMinimum: 1n,
          }),
          pair: STOCK_PAIR,
        }),
      ),
    ).toThrow(/only available for the WETH pair/)
  })

  it('requires a positive uint128 minimum output for every dev buy', () => {
    const devBuyEth = 1_000_000_000_000_000n

    expect(() => buildLaunchConfig(args({ draft: draft({ devBuyEth }) }))).toThrow(
      /minimum output is required/,
    )
    expect(() =>
      buildLaunchConfig(args({ draft: draft({ devBuyEth, devBuyAmountOutMinimum: 0n }) })),
    ).toThrow(/greater than zero/)
    expect(() =>
      buildLaunchConfig(
        args({
          draft: draft({
            devBuyEth,
            devBuyAmountOutMinimum: MAX_DEV_BUY_AMOUNT_OUT_MINIMUM + 1n,
          }),
        }),
      ),
    ).toThrow(/exceeds uint128/)
  })

  it('rejects invalid dev-buy recipients and safely encodes uint128.max', () => {
    expect(() =>
      buildLaunchConfig(
        args({
          draft: draft({
            devBuyEth: 1n,
            devBuyAmountOutMinimum: 1n,
            devBuyRecipient: '0x0000000000000000000000000000000000000000',
          }),
        }),
      ),
    ).toThrow(/recipient must be a non-zero address/)

    expect(() =>
      encodeDevBuyData({ recipient: 'not-an-address' as Address, amountOutMinimum: 1n }),
    ).toThrow(/recipient must be a non-zero address/)
    expect(() => encodeDevBuyData({ recipient: CREATOR, amountOutMinimum: 0n })).toThrow(
      /greater than zero/,
    )

    const encoded = encodeDevBuyData({
      recipient: CREATOR,
      amountOutMinimum: MAX_DEV_BUY_AMOUNT_OUT_MINIMUM,
    })
    const [decoded] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'recipient', type: 'address' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'pairedTokenPoolKey', type: 'bytes' },
          ],
        },
      ],
      encoded,
    )
    expect(decoded.amountOutMinimum).toBe(MAX_DEV_BUY_AMOUNT_OUT_MINIMUM)
  })

  it('threads dev-buy extension value into the prepared transaction', () => {
    const devBuyEth = 1_000_000_000_000_000n
    const devBuyAmountOutMinimum = 123_000_000_000_000_000n
    const plan = prepareLaunchB20(
      args({ draft: draft({ devBuyEth, devBuyAmountOutMinimum }) }),
    )
    const config = plan.args[0] as ReturnType<typeof buildLaunchConfig>
    expect(config.extensionConfigs).toHaveLength(1)
    expect(config.extensionConfigs[0]!.extension).toBe(DEVBUY)
    expect(config.extensionConfigs[0]!.msgValue).toBe(devBuyEth)
    const [devBuyConfig] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'recipient', type: 'address' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'pairedTokenPoolKey', type: 'bytes' },
          ],
        },
      ],
      config.extensionConfigs[0]!.extensionData,
    )
    expect(devBuyConfig.recipient).toBe(CREATOR)
    expect(devBuyConfig.amountOutMinimum).toBe(devBuyAmountOutMinimum)
    expect(devBuyConfig.pairedTokenPoolKey).toBe('0x')
    expect(plan.value).toBe(devBuyEth)
    expect(plan.warnings.join(' ')).toContain('at least 0.123 RWG is received')
  })
})

describe('parseLaunchReceipt', () => {
  function makeLog({
    emitter = LAUNCHER,
    token = '0x0000000000000000000000000000000000000abc' as const,
    symbol = 'RWG',
  }: {
    emitter?: Address
    token?: Address
    symbol?: string
  } = {}): Log {
    const item = getAbiItem({ abi: rwagmiLauncherAbi, name: 'B20TokenCreated' })
    const topics = encodeEventTopics({
      abi: rwagmiLauncherAbi,
      eventName: 'B20TokenCreated',
      args: { msgSender: CREATOR, tokenAddress: token, tokenAdmin: CREATOR },
    })
    const nonIndexed = (item as { inputs: readonly { indexed?: boolean }[] }).inputs.filter((i) => !i.indexed)
    const data = encodeAbiParameters(nonIndexed as never, [
      'RWAGMI Token',
      symbol,
      18,
      0,
      HOOK,
      ('0x' + 'ab'.repeat(32)) as Hex,
      10_000,
      200,
      PAIRED,
      LOCKER,
      MEV,
      1_000_000n * 10n ** 18n,
      0n,
      0,
      [],
    ] as never)
    return { address: emitter, topics, data } as unknown as Log
  }

  it('extracts the launch result from B20TokenCreated', () => {
    const result = parseLaunchReceipt({ logs: [makeLog()] }, LAUNCHER)
    expect(result).not.toBeNull()
    expect(result!.token.toLowerCase()).toBe('0x0000000000000000000000000000000000000abc')
    expect(result!.symbol).toBe('RWG')
    expect(result!.hook).toBe(HOOK)
    expect(result!.locker).toBe(LOCKER)
    expect(result!.pairedToken).toBe(PAIRED)
    expect(result!.startingTick).toBe(0)
    expect(result!.lpFee).toBe(10_000)
    expect(result!.tickSpacing).toBe(200)
    expect(result!.mevModule).toBe(MEV)
    expect(result!.adminMode).toBe('immutable')
  })

  it('filters same-signature events to the launcher contract when supplied', () => {
    const foreign = '0x9999999999999999999999999999999999999999' as const
    const result = parseLaunchReceipt(
      {
        logs: [
          makeLog({
            emitter: foreign,
            token: '0x0000000000000000000000000000000000000def',
            symbol: 'BAD',
          }),
          makeLog(),
        ],
      },
      LAUNCHER,
    )

    expect(result).not.toBeNull()
    expect(result!.token.toLowerCase()).toBe('0x0000000000000000000000000000000000000abc')
    expect(result!.symbol).toBe('RWG')
  })

  it('returns null when the event is absent', () => {
    expect(parseLaunchReceipt({ logs: [] })).toBeNull()
  })
})

describe('launch reward writes', () => {
  it('prepares permissionless launch LP fee collection', () => {
    const plan = prepareCollectLaunchRewards({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      locker: LOCKER,
      token: '0x0000000000000000000000000000000000000abc',
      symbol: 'RWG',
    })

    expect(plan.kind).toBe('collectLaunchRewards')
    expect(plan.functionName).toBe('collectRewards')
    expect(plan.to).toBe(LOCKER)
    expect(plan.args).toEqual(['0x0000000000000000000000000000000000000abc'])
    expect(plan.riskLevel).toBe('medium')
    expect(plan.requiredRole).toBeUndefined()
    expect(plan.warnings.join(' ')).toMatch(/v4 LP fees/i)
    expect(plan.warnings.join(' ')).toMatch(/recipients/i)
  })

  it('prepares caller-side credited reward claiming', () => {
    const plan = prepareClaimLaunchRewards({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      locker: LOCKER,
      token: '0x0000000000000000000000000000000000000abc',
      currency: PAIRED,
      currencySymbol: 'WETH',
    })

    expect(plan.kind).toBe('claimLaunchRewards')
    expect(plan.functionName).toBe('claimRewards')
    expect(plan.to).toBe(LOCKER)
    expect(plan.args).toEqual([PAIRED])
    expect(plan.riskLevel).toBe('low')
    expect(plan.requiredRole).toBeUndefined()
    expect(plan.warnings.join(' ')).toMatch(/connected wallet/i)
  })

  it('prepares launch reward recipient rotation as a high-risk slot-admin action', () => {
    const newRecipient = '0x6666666666666666666666666666666666666666' as const
    const token = '0x0000000000000000000000000000000000000abc' as const
    const plan = prepareUpdateLaunchRewardRecipient(
      {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        locker: LOCKER,
        token,
        symbol: 'RWG',
      },
      1n,
      newRecipient,
    )

    expect(plan.kind).toBe('updateLaunchRewardRecipient')
    expect(plan.functionName).toBe('updateRewardRecipient')
    expect(plan.to).toBe(LOCKER)
    expect(plan.args).toEqual([token, 1n, newRecipient])
    expect(plan.riskLevel).toBe('high')
    expect(plan.warnings.join(' ')).toMatch(/admin for this reward slot/i)
    expect(plan.warnings.join(' ')).toMatch(/bps are immutable/i)
  })
})
