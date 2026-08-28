import { describe, expect, it } from 'vitest'
import { getAddress, type Hex } from 'viem'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_LAUNCH_LP_FEE,
  alignedStartingPrice,
  buildLaunchConfig,
  buildLaunchPairRegistry,
  DEFAULT_LAUNCH_PAIR_MODULES,
  defaultLaunchPairs,
  evaluatePairPreflight,
  LAUNCH_PAIR_FACTS,
  decodeRevertData,
  launchPairFrom,
  resolveLaunchPairs,
  launchPairKey,
  prepareLaunchB20,
  type BuildLaunchArgs,
  type LaunchDraft,
  type LaunchPairConfig,
} from '../src/index.js'
import { rwagmiPairBoundSniperAuctionV1Abi } from '../src/abi/rwagmi-pair-bound-sniper-auction-v1.js'
import { encodeErrorResult } from 'viem'

const LAUNCHER = '0x1111111111111111111111111111111111111111' as const
const HOOK = '0x2222222222222222222222222222222222222222' as const
const LOCKER = '0x3333333333333333333333333333333333333333' as const
const DEVBUY = '0x7777777777777777777777777777777777777777' as const
const CREATOR = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as const
const RWAGMI_R = '0x4444444444444444444444444444444444444444' as const
const RWAGMI_A = '0x5555555555555555555555555555555555555555' as const

const WETH = '0x4200000000000000000000000000000000000006' as const
const GOOGLC = getAddress('0xb2000000000000000000002d0ba3164cc74f58b7')
const AAPLC = getAddress('0xb200000000000000000000C2e324d24d7eEcd1fb')

const WETH_MODULE = getAddress('0x00000000000000000000000000000000000e0001')
const GOOGLC_MODULE = getAddress('0x00000000000000000000000000000000000e0002')
const AAPLC_MODULE = getAddress('0x00000000000000000000000000000000000e0003')

const wethPair: LaunchPairConfig = {
  chainId: BASE_MAINNET_CHAIN_ID,
  token: WETH,
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  defaultOpeningPrice: '0.000000000025',
  mevModule: WETH_MODULE,
  supportsEthDevBuy: true,
  riskLabel: 'canonical-weth',
}

const googlPair: LaunchPairConfig = {
  chainId: BASE_MAINNET_CHAIN_ID,
  token: GOOGLC,
  name: 'Alphabet Inc.',
  symbol: 'GOOGLc',
  decimals: 8,
  defaultOpeningPrice: '0.000000000125',
  mevModule: GOOGLC_MODULE,
  supportsEthDevBuy: false,
  riskLabel: 'admin-controlled-b20-stock',
}

const aaplPair: LaunchPairConfig = {
  chainId: BASE_MAINNET_CHAIN_ID,
  token: AAPLC,
  name: 'Apple Inc.',
  symbol: 'AAPLc',
  decimals: 8,
  defaultOpeningPrice: '0.000000000125',
  mevModule: AAPLC_MODULE,
  supportsEthDevBuy: false,
  riskLabel: 'admin-controlled-b20-stock',
}

describe('curated pair registry', () => {
  it('looks up by chain and token, and normalises case', () => {
    const registry = buildLaunchPairRegistry([wethPair, googlPair])
    expect(registry).toHaveLength(2)
    expect(registry.map((p) => p.symbol)).toEqual(['WETH', 'GOOGLc'])
    // WETH sorts first so it is the natural default.
    expect(registry[0]!.supportsEthDevBuy).toBe(true)
  })

  it('drops an entry whose module is missing or zero, disabling that pair', () => {
    expect(buildLaunchPairRegistry([{ ...googlPair, mevModule: undefined }])).toHaveLength(0)
    expect(
      buildLaunchPairRegistry([
        { ...googlPair, mevModule: '0x0000000000000000000000000000000000000000' },
      ]),
    ).toHaveLength(0)
    expect(buildLaunchPairRegistry([{ ...googlPair, mevModule: 'not-an-address' }])).toHaveLength(0)
  })

  it('ships a pair-correct default opening price for every curated pair', () => {
    // A WETH-denominated figure is meaningless against an 8-decimal stock, so
    // each pair carries its own. These are arbitrary round numbers, chosen so
    // the default supply opens near $4k of nominal value — not valuations.
    const byToken = new Map(
      LAUNCH_PAIR_FACTS.filter((f) => f.chainId === BASE_MAINNET_CHAIN_ID).map((f) => [
        f.symbol,
        f.defaultOpeningPrice,
      ]),
    )
    expect(byToken.get('WETH')).toBe('0.000000000025')
    expect(byToken.get('GOOGLc')).toBe('0.000000000125')
    expect(byToken.get('AAPLc')).toBe('0.000000000125')
    // Share prices span too wide a range for one shared stock constant:
    // NVDA ~$225 and META ~$565 would sit at half and double the target.
    expect(byToken.get('NVDAc')).toBe('0.0000000002')
    expect(byToken.get('METAc')).toBe('0.000000000075')
    // Every fact entry must have one, or the form has nothing to seed with.
    for (const f of LAUNCH_PAIR_FACTS) {
      expect(Number(f.defaultOpeningPrice)).toBeGreaterThan(0)
    }
  })

  it('lists every curated stock as an 8-decimal, dev-buy-ineligible pair', () => {
    const stocks = LAUNCH_PAIR_FACTS.filter(
      (f) => f.riskLabel === 'admin-controlled-b20-stock',
    )
    // COINc/SPCXc/TSLAc were unminted when added: checked in so the wiring is
    // ready, still gated behind a module address like every other pair.
    expect(stocks.map((f) => f.symbol).sort()).toEqual([
      'AAPLc',
      'COINc',
      'GOOGLc',
      'METAc',
      'NVDAc',
      'SPCXc',
      'TSLAc',
    ])
    for (const f of stocks) {
      // 8 decimals, not 18 — the factor-of-10^10 trap the registry exists to close.
      expect(f.decimals).toBe(8)
      // RwagmiEthDevBuy reverts on any non-WETH pair.
      expect(f.supportsEthDevBuy).toBe(false)
      expect(f.chainId).toBe(BASE_MAINNET_CHAIN_ID)
    }
    // Every token address is distinct.
    expect(new Set(LAUNCH_PAIR_FACTS.map((f) => `${f.chainId}:${f.token}`)).size).toBe(
      LAUNCH_PAIR_FACTS.length,
    )
  })

  it('gives every curated stock a USD price feed, and WETH none', () => {
    for (const f of LAUNCH_PAIR_FACTS) {
      if (f.riskLabel === 'admin-controlled-b20-stock') {
        // Without a feed a stock pool can only ever render in its own symbol.
        expect(f.usdPriceFeed).toBeDefined()
        expect(f.usdPriceFeed).toMatch(/^0x[0-9a-fA-F]{40}$/)
      } else {
        // WETH converts through the ETH spot rate, not a Chainlink equity feed.
        expect(f.usdPriceFeed).toBeUndefined()
      }
    }
    // One feed per stock: a shared feed would price two stocks identically.
    const feeds = LAUNCH_PAIR_FACTS.map((f) => f.usdPriceFeed).filter(Boolean)
    expect(new Set(feeds).size).toBe(feeds.length)
  })

  it('drops an entry whose price feed is present but malformed', () => {
    // Absent is fine — the pool renders in its own symbol. Present-but-broken
    // would be read as a price source and silently mis-denominate the pool.
    expect(
      buildLaunchPairRegistry([{ ...googlPair, usdPriceFeed: undefined }]),
    ).toHaveLength(1)
    for (const bad of ['0x0000000000000000000000000000000000000000', '0xnope', '']) {
      expect(
        buildLaunchPairRegistry([
          { ...googlPair, usdPriceFeed: bad as `0x${string}` },
        ]),
      ).toHaveLength(0)
    }
  })

  it('drops an entry whose default opening price is missing or malformed', () => {
    for (const bad of ['', '0', 'abc', '-1', '1e-10', undefined as unknown as string]) {
      expect(
        buildLaunchPairRegistry([{ ...googlPair, defaultOpeningPrice: bad }]),
      ).toHaveLength(0)
    }
  })

  it('drops malformed entries rather than launching against them', () => {
    expect(buildLaunchPairRegistry([{ ...googlPair, decimals: -1 }])).toHaveLength(0)
    expect(buildLaunchPairRegistry([{ ...googlPair, decimals: 1.5 }])).toHaveLength(0)
    expect(buildLaunchPairRegistry([{ ...googlPair, symbol: '' }])).toHaveLength(0)
    expect(buildLaunchPairRegistry([{ ...googlPair, chainId: 1 }])).toHaveLength(0)
  })

  it('refuses to claim ETH dev-buy support for a non-WETH pair', () => {
    expect(
      buildLaunchPairRegistry([{ ...googlPair, supportsEthDevBuy: true }]),
    ).toHaveLength(0)
  })

  it('rejects duplicate paired tokens and reused module addresses', () => {
    expect(buildLaunchPairRegistry([googlPair, { ...googlPair, symbol: 'DUPE' }])).toHaveLength(1)
    // One module is bound to exactly one pair on-chain: sharing one is always
    // a misconfiguration, so the second entry is dropped.
    expect(
      buildLaunchPairRegistry([googlPair, { ...aaplPair, mevModule: GOOGLC_MODULE }]),
    ).toHaveLength(1)
  })

  it('each stock resolves only to its own module', () => {
    const registry = buildLaunchPairRegistry([wethPair, googlPair, aaplPair])
    const byToken = new Map(registry.map((p) => [p.token, p.mevModule]))
    expect(byToken.get(WETH)).toBe(WETH_MODULE)
    expect(byToken.get(GOOGLC)).toBe(GOOGLC_MODULE)
    expect(byToken.get(AAPLC)).toBe(AAPLC_MODULE)
    expect(new Set(registry.map((p) => p.mevModule)).size).toBe(3)
  })

  it('returns null for an unregistered or malformed token', () => {
    const pairs = buildLaunchPairRegistry([wethPair, googlPair])
    expect(launchPairFrom(pairs, '0xdead')).toBeNull()
    expect(launchPairFrom(pairs, '0x000000000000000000000000000000000000dEaD')).toBeNull()
    expect(launchPairFrom(pairs, GOOGLC)?.symbol).toBe('GOOGLc')
  })

  it('resolves curated facts against supplied module addresses', () => {
    const pairs = resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {
      [launchPairKey(BASE_MAINNET_CHAIN_ID, WETH)]: WETH_MODULE,
      [launchPairKey(BASE_MAINNET_CHAIN_ID, GOOGLC)]: GOOGLC_MODULE,
    })
    expect(pairs.map((p) => p.symbol)).toEqual(['WETH', 'GOOGLc'])
    expect(launchPairFrom(pairs, GOOGLC)?.mevModule).toBe(GOOGLC_MODULE)
    expect(launchPairFrom(pairs, AAPLC)).toBeNull()
  })

  it('yields an empty list when no modules are configured, disabling launch', () => {
    expect(resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {})).toEqual([])
  })

  it('fails closed on a stock-only configuration', () => {
    // A build that ships a stock module but NOT the canonical WETH module would
    // otherwise make a stock the default pair, inheriting WETH-shaped product
    // defaults (opening price, dev-buy affordance, preview copy) for it.
    // Phase A of the cutover always enables WETH first, so this state is always
    // a misconfiguration — disable launching rather than serve it.
    expect(
      resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {
        [launchPairKey(BASE_MAINNET_CHAIN_ID, GOOGLC)]: GOOGLC_MODULE,
      }),
    ).toEqual([])

    expect(
      resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {
        [launchPairKey(BASE_MAINNET_CHAIN_ID, GOOGLC)]: GOOGLC_MODULE,
        [launchPairKey(BASE_MAINNET_CHAIN_ID, AAPLC)]: AAPLC_MODULE,
      }),
    ).toEqual([])
  })

  it('serves stock pairs once WETH is also configured', () => {
    const pairs = resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {
      [launchPairKey(BASE_MAINNET_CHAIN_ID, WETH)]: WETH_MODULE,
      [launchPairKey(BASE_MAINNET_CHAIN_ID, GOOGLC)]: GOOGLC_MODULE,
    })
    expect(pairs.map((p) => p.symbol)).toEqual(['WETH', 'GOOGLc'])
    // WETH is always first, so it is always the form's initial pair.
    expect(pairs[0]!.supportsEthDevBuy).toBe(true)
  })
})

function draft(overrides: Partial<LaunchDraft> = {}): LaunchDraft {
  return {
    variant: 'asset',
    name: 'RWAGMI Token',
    symbol: 'RWG',
    decimals: 18,
    salt: (`0x${'11'.repeat(32)}`) as Hex,
    poolSupply: 1_000_000n * 10n ** 18n,
    creatorRecipient: CREATOR,
    creatorAdmin: CREATOR,
    pairedToken: GOOGLC,
    lpFee: DEFAULT_LAUNCH_LP_FEE,
    initialPrice: 0.0001,
    initialAdmin: CREATOR,
    ...overrides,
  }
}

function args(overrides: Partial<BuildLaunchArgs> = {}): BuildLaunchArgs {
  return {
    draft: draft(),
    chainId: BASE_MAINNET_CHAIN_ID,
    addresses: { launcher: LAUNCHER, hook: HOOK, locker: LOCKER, devBuyExtension: DEVBUY },
    rwagmiFee: { recipient: RWAGMI_R, admin: RWAGMI_A },
    // Sorts below GOOGLc, so the launch token is currency0.
    predictedToken: '0x0000000000000000000000000000000000000abc',
    pair: googlPair,
    ...overrides,
  }
}

describe('shipped default modules', () => {
  it('resolves mainnet pairs with no configuration', () => {
    const pairs = defaultLaunchPairs(BASE_MAINNET_CHAIN_ID)

    expect(pairs.length).toBeGreaterThan(0)
    // WETH must lead, or `resolveLaunchPairs` would have failed the list closed.
    expect(pairs[0].token).toBe(getAddress(WETH))
    expect(pairs[0].supportsEthDevBuy).toBe(true)
    for (const pair of pairs) {
      expect(pair.chainId).toBe(BASE_MAINNET_CHAIN_ID)
      expect(pair.mevModule).toBe(getAddress(pair.mevModule))
    }
  })

  it('binds one module to one pair', () => {
    const modules = Object.values(DEFAULT_LAUNCH_PAIR_MODULES).map((m) =>
      m.toLowerCase(),
    )
    expect(new Set(modules).size).toBe(modules.length)
    // A module shared across pairs would be dropped by the registry, so a
    // duplicate here silently shrinks the launchable set.
    expect(defaultLaunchPairs(BASE_MAINNET_CHAIN_ID).length).toBe(modules.length)
  })

  it('is empty on a chain with no deployed module', () => {
    expect(defaultLaunchPairs(BASE_SEPOLIA_CHAIN_ID)).toEqual([])
    expect(defaultLaunchPairs(1)).toEqual([])
  })
})

describe('pair-aware launch builder', () => {
  it('uses the selected pair token and its own bound module', () => {
    const c = buildLaunchConfig(args())
    expect(c.poolConfig.pairedToken).toBe(GOOGLC)
    expect(c.mevModuleConfig.mevModule).toBe(GOOGLC_MODULE)
    expect(c.mevModuleConfig.mevModuleData).toBe('0x')
  })

  it('rejects a draft pair that differs from the selected registry entry', () => {
    expect(() => buildLaunchConfig(args({ draft: draft({ pairedToken: AAPLC }) }))).toThrow(
      /does not match the selected pair/,
    )
  })

  it('rejects an unregistered pair', () => {
    expect(() =>
      buildLaunchConfig(
        args({
          pair: undefined as unknown as LaunchPairConfig,
          draft: draft({ pairedToken: '0x000000000000000000000000000000000000bEEF' }),
        }),
      ),
    ).toThrow(/not an approved launch pair/)
  })

  it('rejects a pair registered for a different chain', () => {
    expect(() =>
      buildLaunchConfig(args({ pair: { ...googlPair, chainId: BASE_SEPOLIA_CHAIN_ID } })),
    ).toThrow(/registered for chain/)
  })

  it('rejects a zero or missing pair module', () => {
    expect(() =>
      buildLaunchConfig(
        args({
          pair: { ...googlPair, mevModule: '0x0000000000000000000000000000000000000000' },
        }),
      ),
    ).toThrow(/non-zero address/)
  })

  it('rejects a stale draft decimals value that disagrees with the pair', () => {
    // The old `?? 18` fallback made this silently mis-scale by 10 ** 10.
    expect(() =>
      buildLaunchConfig(args({ draft: draft({ pairedDecimals: 18 }) })),
    ).toThrow(/do not match the selected pair/)
  })

  it('uses registry decimals for tick math, not a hardcoded 18', () => {
    const eightDec = buildLaunchConfig(args())
    const eighteenDec = buildLaunchConfig(
      args({
        pair: wethPair,
        draft: draft({ pairedToken: WETH }),
      }),
    )
    // Same human price, different pair decimals => different raw ratio => tick
    // separated by ln(10 ** 10) / ln(1.0001).
    expect(eightDec.poolConfig.tickIfToken0IsB20).not.toBe(
      eighteenDec.poolConfig.tickIfToken0IsB20,
    )
    const expected = alignedStartingPrice(0.0001, 18, 8, 200).startingTick
    expect(eightDec.poolConfig.tickIfToken0IsB20).toBe(expected)
  })

  it('orients the one-sided range for both token address orderings', () => {
    // The launcher derives the pool's real starting tick as
    // `b20IsCurrency0 ? tickIfToken0IsB20 : -tickIfToken0IsB20`, and requires
    // every range to sit entirely on the launch token's side of it.

    // predicted < GOOGLc: launch token is currency0, ranges sit at or above start.
    const asCurrency0 = buildLaunchConfig(args())
    const start0 = asCurrency0.poolConfig.tickIfToken0IsB20
    expect(asCurrency0.lockerConfig.tickLower.every((t) => t >= start0)).toBe(true)

    // predicted > GOOGLc: launch token is currency1, ranges mirror to at or
    // below the negated start (which is positive for this 8-decimal pair).
    const asCurrency1 = buildLaunchConfig(
      args({ predictedToken: '0xfFfF000000000000000000000000000000000abc' }),
    )
    const start1 = -asCurrency1.poolConfig.tickIfToken0IsB20
    expect(asCurrency1.lockerConfig.tickUpper.every((t) => t <= start1)).toBe(true)
    // The two orientations are genuinely mirrored, not accidentally identical.
    expect(start1).toBe(-start0)
  })
})

describe('dev buy is WETH-only', () => {
  it('keeps working for the WETH pair', () => {
    const c = buildLaunchConfig(
      args({
        pair: wethPair,
        draft: draft({
          pairedToken: WETH,
          devBuyEth: 10n ** 17n,
          devBuyAmountOutMinimum: 1n,
        }),
      }),
    )
    expect(c.extensionConfigs).toHaveLength(1)
    expect(c.extensionConfigs[0]!.msgValue).toBe(10n ** 17n)
  })

  it('is rejected before simulation for a stock pair', () => {
    expect(() =>
      buildLaunchConfig(
        args({ draft: draft({ devBuyEth: 10n ** 17n, devBuyAmountOutMinimum: 1n }) }),
      ),
    ).toThrow(/only available for the WETH pair/)
  })

  it('produces empty extensions and zero attached value for a stock launch', () => {
    const c = buildLaunchConfig(args())
    expect(c.extensionConfigs).toEqual([])

    const prepared = prepareLaunchB20(args())
    expect(prepared.value ?? 0n).toBe(0n)
  })
})

describe('V1 error decoding', () => {
  type V1ErrorName = Extract<
    (typeof rwagmiPairBoundSniperAuctionV1Abi)[number],
    { type: 'error' }
  >['name']

  const decode = (errorName: V1ErrorName, errorArgs: readonly unknown[]) =>
    decodeRevertData(
      encodeErrorResult({
        abi: rwagmiPairBoundSniperAuctionV1Abi,
        errorName,
        args: errorArgs as never,
      }),
    )

  it('explains a pair/module mismatch actionably', () => {
    const d = decode('PairedTokenNotInPool', [WETH, GOOGLC, AAPLC])
    expect(d.name).toBe('PairedTokenNotInPool')
    expect(d.message).toMatch(/bound to a different paired token/i)
  })

  it('explains a swap-time pair mismatch', () => {
    const d = decode('PairedTokenMismatch', [WETH, GOOGLC])
    expect(d.name).toBe('PairedTokenMismatch')
    expect(d.message).toMatch(/does not contain the paired token/i)
  })

  it('explains unexpected module data and invalid auction params', () => {
    expect(decode('UnexpectedMevModuleData', []).message).toMatch(/takes no configuration/i)
    expect(decode('InvalidAuctionParams', []).message).toMatch(/nonzero max rounds/i)
  })

  it('explains an unconfigured module rather than leaving raw hex', () => {
    const d = decode('AuctionParamsNotConfigured', [])
    expect(d.name).toBe('AuctionParamsNotConfigured')
    expect(d.message).toMatch(/has not been configured/i)
  })

  it('explains a missing locker fee-source grant', () => {
    const d = decode('NotLockerFeeSource', [])
    expect(d.name).toBe('NotLockerFeeSource')
    expect(d.message).toMatch(/not authorised to credit rewards/i)
  })
})

describe('paired-token preflight', () => {
  it('accepts a pair with any code at all, including a one-byte precompile', () => {
    // Base's tokenized stocks report exactly one byte (`0xef`). That is enough
    // for SafeERC20's `Address` guard, which only rejects a length of zero.
    expect(evaluatePairPreflight(googlPair, '0xef').status).toBe('ok')
    expect(evaluatePairPreflight(wethPair, '0x6080604052').status).toBe('ok')
  })

  it('refuses a pair whose address holds no code', () => {
    // Base's own guide describes these precompiles as holding no bytecode. If
    // that ever becomes literally true, the locker's `safeTransfer` reverts
    // `AddressEmptyCode` and the stock side of every pool's LP fees is stranded
    // permanently — so refuse before the pool exists rather than after.
    for (const empty of ['0x' as const, undefined]) {
      const result = evaluatePairPreflight(googlPair, empty)
      expect(result.status).toBe('no-bytecode')
      expect(result.reason).toContain('GOOGLc')
      expect(result.reason).toContain('never be claimed')
    }
  })
})
