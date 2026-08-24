import { getAddress, isAddress as isViemAddress, type Address } from 'viem'
import { BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, isSupportedChainId } from '../chains.js'
import { BASE_WETH } from '../deployments.js'

/**
 * Risk label shown next to a pair in the launch UI.
 *
 * - `canonical-weth`: the chain's canonical wrapped-ETH contract. No issuer.
 * - `admin-controlled-b20-stock`: a third-party B20 Asset whose issuer retains
 *   admin powers — transfer policy, pause, and uncapped mint/burn. Those can
 *   block or dilute an ALREADY CREATED pool; removing the pair from the
 *   launcher allowlist only stops NEW launches.
 *
 *   NOT in that list: the Asset multiplier. It scales `scaledBalanceOf` only —
 *   `balanceOf`, `totalSupply` and `transfer` are raw and unaffected — so it
 *   cannot desync a v4 pool. Verified on a Base mainnet fork.
 */
export type LaunchPairRiskLabel = 'canonical-weth' | 'admin-controlled-b20-stock'

/** One approved launch pair, with the auction module bound to exactly this token. */
export interface LaunchPairConfig {
  chainId: number
  token: Address
  name: string
  symbol: string
  decimals: number
  /**
   * The `RwagmiPairBoundSniperAuctionV1` instance whose immutable
   * `pairedToken()` is `token`. Selecting any other module makes the launch
   * revert on-chain, so this mapping is authoritative, never a default.
   */
  mevModule: Address
  /**
   * Arbitrary round starting price, in THIS pair's units per launch token, used
   * to seed the `/launch` form. Purely a starting point a creator can change —
   * chosen so the default 100,000,000,000 supply opens somewhere around $4k of
   * nominal value, matching the long-standing WETH default's ballpark.
   *
   * It is a plain decimal string so it round-trips through the form untouched.
   * Every pair needs its own: a WETH-denominated figure is meaningless against
   * an 8-decimal stock, which is the whole reason the form clears the price on
   * a pair change.
   */
  defaultOpeningPrice: string
  /** ETH dev buy is WETH-only: `RwagmiEthDevBuy` reverts on any other pair. */
  supportsEthDevBuy: boolean
  riskLabel: LaunchPairRiskLabel
  /**
   * Chainlink feed quoting ONE WHOLE unit of this pair in USD, when Base
   * publishes one. Present for the tokenized stocks; absent for WETH, whose
   * USD rate comes from the long-standing ETH spot path instead.
   *
   * The stock feeds report total-return values, i.e. the quoted price already
   * includes the B20 multiplier, so it can be applied to a raw pool price with
   * no multiplier maths. They are also deliberately NOT continuous: they hold
   * the last close outside market hours and freeze during corporate actions.
   * Callers must carry the quote's `updatedAt` through to the UI rather than
   * presenting a Friday close as a live number — see `STOCK_USD_FEED_MAX_AGE_SEC`.
   */
  usdPriceFeed?: Address
}

/**
 * Oldest stock quote we will still convert to USD.
 *
 * Base's feeds update on a 0.5% deviation or a 24-hour heartbeat *during market
 * hours*, then hold the last close through weekends and holidays. So a quote
 * several days old is normal, not broken: a naive 24-hour staleness bound would
 * blank every stock market cap from Friday evening to Monday morning.
 *
 * Five days clears the longest ordinary gap — a Thursday close before a Friday
 * holiday reopens ~92 hours later — while still refusing a feed that has been
 * frozen through a corporate action or abandoned outright. Past this bound the
 * pool keeps rendering in its own pair units, which is always truthful.
 */
export const STOCK_USD_FEED_MAX_AGE_SEC = 5 * 24 * 60 * 60

/**
 * A registry entry before validation. `mevModule` is optional because a pair's
 * facts are checked in here as soon as they are known, but the pair stays
 * invisible to the product until its pair-bound module is deployed and its
 * address supplied. An entry without a module is dropped rather than falling
 * back to some other module.
 */
type LaunchPairDraft = Omit<LaunchPairConfig, 'mevModule'> & { mevModule?: string }

/** Stable key for supplying a pair's deployed module address. */
export type LaunchPairKey = `${number}:${string}`

export function launchPairKey(chainId: number, token: string): LaunchPairKey {
  return `${chainId}:${token.toLowerCase()}` as LaunchPairKey
}

/**
 * Curated, source-controlled pair facts. This is build-time product
 * configuration reviewed in git — there is deliberately no arbitrary-address
 * path and no runtime override.
 *
 * Module addresses are NOT here: they are deployment inputs, supplied by the
 * app through `resolveLaunchPairs` (mirroring `resolveLauncherAddresses`), so
 * that a bundler can statically inline its build-time env values.
 *
 * Listing a stock here is NOT sufficient to enable it: the launcher must also
 * have `setPairedToken(token, true)` and `setMevModule(module, true)`, and the
 * locker must have `setFeeSource(module, true)`. Until all three are done, a
 * listed pair is not launchable — `selectLiveLaunchPairs` reads the first two
 * from chain so your app never offers one that is not.
 */
export const LAUNCH_PAIR_FACTS: readonly Omit<LaunchPairConfig, 'mevModule'>[] = [
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress(BASE_WETH),
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    // Long-standing RWAGMI default: 1e11 supply opens at 2.5 WETH nominal.
    defaultOpeningPrice: '0.000000000025',
    supportsEthDevBuy: true,
    riskLabel: 'canonical-weth',
  },
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    token: getAddress(BASE_WETH),
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    defaultOpeningPrice: '0.000000000025',
    supportsEthDevBuy: true,
    riskLabel: 'canonical-weth',
  },
  // --- Approved B20 stock pairs -------------------------------------------
  // Facts verified on Base mainnet: GOOGLc/AAPLc 2026-08-17, NVDAc/METAc
  // 2026-08-18, COINc/SPCXc/TSLAc 2026-08-23. All seven are 8-decimal B20
  // Assets sharing one issuer (same DEFAULT_ADMIN / OPERATOR / MINT role
  // holders) which retains live mint/burn, pause and transfer-policy powers,
  // with `multiplier() == 1e18`, an uncapped `supplyCap`, no paused features,
  // and the permissive policy id 5 on all four scopes.
  // They stay invisible until a module address is supplied, which must not
  // happen before the pair passes RWAGMI's eligibility checklist AND its live
  // acceptance launch.
  //
  // The last three are ISSUED BUT UNMINTED: at 2026-08-23 each had
  // `totalSupply() == 0` and a zero v4 singleton balance. They are checked in
  // here so the wiring is ready the day supply appears, but they CANNOT be
  // enabled before then — the hook fronts the auction payment with
  // `PoolManager.take`, which reverts against a zero singleton balance, and a
  // token with no supply has no routing leg either.
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000002d0ba3164cc74f58b7'),
    name: 'Alphabet Inc.',
    symbol: 'GOOGLc',
    decimals: 8,
    // Arbitrary round number, like the WETH figure — a starting point, not a
    // valuation. Sized so the default supply opens near $4k: ~$4.3k at
    // ~$344/share. Every stock needs its own, because share prices span a wide
    // enough range (NVDA ~$225 to META ~$565) that one shared constant would
    // put some pairs at half the target and others at double. Nothing breaks if
    // these drift; the opening cap just shifts, exactly as WETH's already does.
    defaultOpeningPrice: '0.000000000125',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase GOOGL`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000C2e324d24d7eEcd1fb'),
    name: 'Apple Inc.',
    symbol: 'AAPLc',
    decimals: 8,
    // ~$3.8k at ~$305/share.
    defaultOpeningPrice: '0.000000000125',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase AAPL`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x787f13dEa48Db0897CbCDD985de77809D837F988'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000078ee7ce2fE4908108C'),
    name: 'NVIDIA Corporation',
    symbol: 'NVDAc',
    decimals: 8,
    // ~$4.4k at ~$225/share.
    defaultOpeningPrice: '0.0000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase NVDA`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x04689a41629776563E6822F76f2e57D148d28513'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000008bC8786B856E61707C'),
    name: 'Meta Platforms Inc.',
    symbol: 'METAc',
    decimals: 8,
    // ~$4.2k at ~$565/share.
    defaultOpeningPrice: '0.000000000075',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase META`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D'),
  },
  // --- Unminted at 2026-08-23: ready to wire, not ready to enable ----------
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000c85a31389D71F3ecfb'),
    name: 'Coinbase Global Inc.',
    symbol: 'COINc',
    decimals: 8,
    // ~$3.8k at ~$189/share (feed, 2026-08-21 close).
    defaultOpeningPrice: '0.0000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase COIN`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x408e44f504A7371a345F03a73dDC96A4b48e8aa7'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000007b9fcbd005511aCBd5'),
    name: 'Space Exploration Technologies Corp.',
    symbol: 'SPCXc',
    decimals: 8,
    // ~$4.1k at ~$137/share (feed, 2026-08-21 close).
    defaultOpeningPrice: '0.0000000003',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase SPCX`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x6A634B235903C4ad6376892180d6fF8612e3Fa68'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000001e800a7f5189430cD0'),
    name: 'Tesla Inc.',
    symbol: 'TSLAc',
    decimals: 8,
    // ~$4.5k at ~$364/share (feed, 2026-08-21 close).
    defaultOpeningPrice: '0.000000000125',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase TSLA`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4'),
  },
]

const isAddress = (v: unknown): v is Address =>
  typeof v === 'string' &&
  isViemAddress(v, { strict: false }) &&
  v !== '0x0000000000000000000000000000000000000000'

function isValidDecimals(d: unknown): d is number {
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 36
}

/**
 * Normalise and validate one draft. Returns null when anything is missing or
 * malformed — a broken entry disables that pair rather than launching against a
 * half-configured pool.
 */
function normalise(draft: LaunchPairDraft): LaunchPairConfig | null {
  if (!isSupportedChainId(draft.chainId)) return null
  if (!isAddress(draft.token) || !isAddress(draft.mevModule)) return null
  if (!isValidDecimals(draft.decimals)) return null
  if (!draft.symbol || !draft.name) return null
  // A malformed default would seed the form with garbage in a live denomination.
  if (!/^\d*\.?\d+$/.test(draft.defaultOpeningPrice ?? '')) return null
  if (!(Number(draft.defaultOpeningPrice) > 0)) return null
  // Dev buy routes ETH -> WETH -> launch token in one pool; the on-chain
  // extension rejects every other pair, so the registry must not claim support.
  if (draft.supportsEthDevBuy && getAddress(draft.token) !== getAddress(BASE_WETH)) return null
  // A malformed feed address would be read as a price source and silently
  // mis-denominate the pool. Absent is fine (pair-denominated display);
  // present-but-broken is not.
  if (draft.usdPriceFeed !== undefined && !isAddress(draft.usdPriceFeed)) return null

  return {
    chainId: draft.chainId,
    token: getAddress(draft.token),
    name: draft.name,
    symbol: draft.symbol,
    decimals: draft.decimals,
    defaultOpeningPrice: draft.defaultOpeningPrice,
    mevModule: getAddress(draft.mevModule),
    supportsEthDevBuy: draft.supportsEthDevBuy,
    riskLabel: draft.riskLabel,
    ...(draft.usdPriceFeed === undefined
      ? {}
      : { usdPriceFeed: getAddress(draft.usdPriceFeed) }),
  }
}

/**
 * Build the validated registry. Duplicate paired tokens on a chain, and any
 * module address reused across pairs, are dropped: one module is bound to
 * exactly one pair on-chain, so a shared module address is always a
 * misconfiguration.
 */
function buildRegistry(drafts: readonly LaunchPairDraft[]): LaunchPairConfig[] {
  const out: LaunchPairConfig[] = []
  const seenToken = new Set<string>()
  const seenModule = new Set<string>()

  for (const draft of drafts) {
    const entry = normalise(draft)
    if (!entry) continue
    const tokenKey = `${entry.chainId}:${entry.token.toLowerCase()}`
    const moduleKey = `${entry.chainId}:${entry.mevModule.toLowerCase()}`
    if (seenToken.has(tokenKey) || seenModule.has(moduleKey)) continue
    seenToken.add(tokenKey)
    seenModule.add(moduleKey)
    out.push(entry)
  }
  return out
}

/** Validate an arbitrary draft list with the registry's rules. */
export function buildLaunchPairRegistry(
  drafts: readonly LaunchPairDraft[],
): LaunchPairConfig[] {
  return buildRegistry(drafts)
}

/**
 * Resolve the curated pairs for `chainId`, given the deployed pair-bound module
 * addresses keyed by `launchPairKey(chainId, token)`.
 *
 * Any pair without a valid module is omitted, so a chain with no configured
 * modules yields an empty list and the product disables launching rather than
 * preparing a transaction against the wrong module.
 */
export function resolveLaunchPairs(
  chainId: number,
  modules: Readonly<Record<string, string | undefined>>,
): LaunchPairConfig[] {
  const drafts = LAUNCH_PAIR_FACTS.filter((f) => f.chainId === chainId).map((f) => ({
    ...f,
    mevModule: modules[launchPairKey(f.chainId, f.token)],
  }))
  // WETH first: it is the canonical default and the only dev-buy-capable pair.
  const resolved = buildRegistry(drafts).sort((a, b) =>
    a.supportsEthDevBuy === b.supportsEthDevBuy ? 0 : a.supportsEthDevBuy ? -1 : 1,
  )

  // Fail closed on a stock-only configuration. Every product default — the
  // opening price, the preview copy, the dev-buy affordance — is written for
  // WETH, so a build that ships a stock module WITHOUT the canonical WETH
  // module would silently make a stock the default pair and inherit
  // WETH-shaped defaults for it. That state is always a misconfiguration —
  // WETH is enabled before any stock — so disable launching entirely rather
  // than serve it.
  if (!resolved.some((p) => p.supportsEthDevBuy)) return []
  return resolved
}

/** Look up one resolved pair by paired-token address. Null when unregistered. */
export function launchPairFrom(
  pairs: readonly LaunchPairConfig[],
  token: string,
): LaunchPairConfig | null {
  if (!isAddress(token)) return null
  const target = getAddress(token)
  return pairs.find((p) => p.token === target) ?? null
}

/** The canonical WETH pair from a resolved list, when it is fully configured. */
export function defaultLaunchPair(
  pairs: readonly LaunchPairConfig[],
): LaunchPairConfig | null {
  return pairs.find((p) => p.supportsEthDevBuy) ?? null
}

/**
 * Curated display metadata for an ALREADY EXISTING pool's paired token.
 *
 * Display deliberately uses the facts table rather than the resolved registry:
 * a pool stays live after its pair is removed from the launcher allowlist, so
 * its price must keep rendering correctly even once no module is configured.
 * Returns null for an unknown pair — callers must then withhold formatted
 * amounts rather than assume 18 decimals.
 */
export function launchPairFactsFor(
  chainId: number,
  token: string,
): Omit<LaunchPairConfig, 'mevModule'> | null {
  if (!isAddress(token)) return null
  const target = getAddress(token)
  return (
    LAUNCH_PAIR_FACTS.find((f) => f.chainId === chainId && f.token === target) ?? null
  )
}

/** True when `token` is the canonical WETH for `chainId`. */
export function isWethPair(chainId: number, token: string): boolean {
  return launchPairFactsFor(chainId, token)?.supportsEthDevBuy === true
}
