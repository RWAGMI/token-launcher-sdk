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
   * chosen so the default 100,000,000,000 supply opens somewhere around $4–6k of
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
  /**
   * Listed for the v3 launcher only. No v2 pair-bound auction module exists for
   * it, so `resolveLaunchPairs` never offers it to a v2 launch even if a module
   * address were supplied; v3 enables a pair with one `setPairedToken` call.
   */
  v3Only?: true
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
  // 2026-08-18, COINc/SPCXc/TSLAc 2026-08-23, AMZNc/MSFTc/MSTRc/SNDKc
  // 2026-09-05 (block 50,886,085). All eleven are 8-decimal B20 Assets sharing
  // one issuer (same DEFAULT_ADMIN / OPERATOR / MINT role holders) which
  // retains live mint/burn, pause and transfer-policy powers, with
  // `multiplier() == 1e18`, an uncapped `supplyCap`, no paused features, and
  // the permissive policy id 5 on all four scopes.
  // They stay invisible until a module address is supplied, which must not
  // happen before the pair passes RWAGMI's eligibility checklist AND its live
  // acceptance launch.
  //
  // Base minted six more on 2026-09-05 (AMZNc, MSFTc, MSTRc, SNDKc, plus SPCXc
  // and TSLAc, which had been parked here unminted). Their USDC routing legs
  // are freshly seeded and thinner than the incumbents' — ~$110k TVL each
  // against $0.9-2.4M — but they clear the same 200 bps bar: executed $25k
  // buys cost 54-109 bps against the incumbents' sub-1 bp. Re-measure the
  // routing leg yourself before leaning on one; these pools are days old and
  // the figure moves.
  //
  // CRCLc and INTCc are published by Base but still unminted and not requested,
  // so they are deliberately absent rather than parked here.
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
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000d9192b6B456483C2E8'),
    name: 'Amazon.com Inc.',
    symbol: 'AMZNc',
    decimals: 8,
    // ~$4.0k at ~$258/share.
    defaultOpeningPrice: '0.000000000155',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase AMZN`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000Ab99cFa739E253872B'),
    name: 'Microsoft Corporation',
    symbol: 'MSFTc',
    decimals: 8,
    // ~$4.0k at ~$500/share.
    defaultOpeningPrice: '0.00000000008',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase MSFT`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000004884b426556b92883d'),
    name: 'Strategy Inc.',
    symbol: 'MSTRc',
    decimals: 8,
    // ~$3.9k at ~$143/share.
    defaultOpeningPrice: '0.00000000028',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase MSTR`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000397293Cb8cda9a10c5'),
    name: 'Sandisk Corporation',
    symbol: 'SNDKc',
    decimals: 8,
    // ~$4.0k at ~$1,733/share — the priciest share in the set, so the opening
    // price sits an order of magnitude below its peers. Still ~225k ticks
    // clear of the stranding floor, which is what actually bounds it.
    defaultOpeningPrice: '0.0000000000235',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase SNDK`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000007b9fcbd005511aCBd5'),
    name: 'Space Exploration Technologies Corp.',
    symbol: 'SPCXc',
    decimals: 8,
    // ~$4.0k at ~$148/share. Repriced at mint: the old figure was derived from
    // the 2026-08-21 close while the token was unminted and opened at ~$4.4k.
    defaultOpeningPrice: '0.000000000275',
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
    // ~$4.0k at ~$353/share. Repriced at mint, as SPCXc was.
    defaultOpeningPrice: '0.000000000115',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    // Chainlink `Coinbase TSLA`, 8 decimals, total-return.
    usdPriceFeed: getAddress('0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4'),
  },
  // --- Unminted: ready to wire, not ready to enable ------------------------
  // COINc still had `totalSupply() == 0` and a zero v4 singleton balance at
  // 2026-09-05. It is checked in so the wiring is ready the day supply
  // appears, but it CANNOT be enabled before then — the hook fronts the
  // auction payment with `PoolManager.take`, which reverts against a zero
  // singleton balance, and a token with no supply has no routing leg either.
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
  // --- Coinbase tokenized stocks, 2026-10 --------------------------------
  // The rest of Coinbase's public tokenized-stock catalogue
  // (api.coinbase.com/v1/tokenized-stocks), read on Base mainnet when listed:
  // the same issuer setup as the stocks above. All are 8-decimal B20 Assets
  // whose issuer keeps mint/burn, pause and transfer-policy powers, with
  // multiplier 1e18 and nothing paused. Several were still unminted when
  // listed: check `totalSupply()`, because a pool paired with an unissued
  // stock cannot trade until the issuer mints it.
  //
  // The v3 launcher accepts all of them (see `readLaunchPairsV3`). This SDK
  // ships no v2 auction module for them, so `defaultLaunchPairs` does not offer
  // them for a v2 launch; `v3Only` marks the ones with no v2 module at all.
  // Default opening prices are sized near $6k from each share's closing price.
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000000d8Ce462E99ee7A47B'),
    name: 'Advanced Micro Devices, Inc.',
    symbol: 'AMDc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000B1a29cF17A1819288a'),
    name: 'AST SpaceMobile, Inc.',
    symbol: 'ASTSc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000Fc737aeA6196aB5a4c'),
    name: 'Broadcom Inc.',
    symbol: 'AVGOc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000018',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000016f9dfe862feBA122b'),
    name: 'Bloom Energy Corporation',
    symbol: 'BEc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000027',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000f215E4C890CFb7176B'),
    name: 'Cheesecake Factory Inc',
    symbol: 'CAKEc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000052',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000428E3a3eebBb20692B'),
    name: 'Trump Media & Technology Group Corp.',
    symbol: 'DJTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000092',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000A613D12dEAfBBb1Db7'),
    name: 'Duolingo, Inc.',
    symbol: 'DUOLc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000007790ed6E48e06eD935'),
    name: 'GameStop Corp.',
    symbol: 'GMEc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000023',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000043a599976181Bcf336'),
    name: 'Hims & Hers Health, Inc.',
    symbol: 'HIMSc',
    decimals: 8,
    defaultOpeningPrice: '0.000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000002601C5C94F435da168'),
    name: 'Hertz Global Holdings, Inc.',
    symbol: 'HTZc',
    decimals: 8,
    defaultOpeningPrice: '0.000000029',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000f1a0F91e34892E4718'),
    name: 'Eli Lilly & Co',
    symbol: 'LLYc',
    decimals: 8,
    defaultOpeningPrice: '0.000000000047',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000e215e9B76ecBA02468'),
    name: 'Moderna, Inc.',
    symbol: 'MRNAc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000026',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000eC3c4c7395Cc609813'),
    name: 'Marvell Technology, Inc.',
    symbol: 'MRVLc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000025',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000Fd2f87532B90095211'),
    name: 'Micron Technology Inc.',
    symbol: 'MUc',
    decimals: 8,
    defaultOpeningPrice: '0.000000000066',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000058B8c947e44011dFE6'),
    name: 'Netflix Inc',
    symbol: 'NFLXc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000085',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000C597c476FCf9Aed3a8'),
    name: 'Novavax Inc',
    symbol: 'NVAXc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000055',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000347AFbA223D7B6b63C'),
    name: 'Oracle Corporation',
    symbol: 'ORCLc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000045',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000018FE7eC7d6DfeeB528'),
    name: 'Pfizer Inc',
    symbol: 'PFEc',
    decimals: 8,
    defaultOpeningPrice: '0.000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000007d16372840dF4dAbbe'),
    name: 'Palantir Technologies Inc.',
    symbol: 'PLTRc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000031',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000008FC2A8C23cf5937b66'),
    name: 'Philip Morris International Inc.',
    symbol: 'PMc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000003',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000009272A491812842Aa84'),
    name: 'Peloton Interactive, Inc.',
    symbol: 'PTONc',
    decimals: 8,
    defaultOpeningPrice: '0.000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000450ad3abE5d4846c6E'),
    name: 'PayPal Holdings, Inc.',
    symbol: 'PYPLc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000CA425ab42e07C35bC3'),
    name: 'Quantum Computing Inc.',
    symbol: 'QUBTc',
    decimals: 8,
    defaultOpeningPrice: '0.000000009',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000005bd7AE89b9E6189Bb5'),
    name: 'Roblox Corporation',
    symbol: 'RBLXc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000012',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000066242d4067724cB7A1'),
    name: 'Reddit, Inc.',
    symbol: 'RDDTc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000038',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000002137743D4a01Fe4e88'),
    name: 'SoundHound AI, Inc.',
    symbol: 'SOUNc',
    decimals: 8,
    defaultOpeningPrice: '0.000000013',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000f720C26062Bc3067Da'),
    name: 'Take-Two Interactive Software, Inc.',
    symbol: 'TTWOc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000029',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000044E3CD7a0E1028E57a'),
    name: 'Wendy\'s Co',
    symbol: 'WENc',
    decimals: 8,
    defaultOpeningPrice: '0.000000009',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000535fE96f18204BFD96'),
    name: 'Smartbird, Inc.',
    symbol: 'BIRDc',
    decimals: 8,
    defaultOpeningPrice: '0.000000026',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000cf36D05963A3E2205c'),
    name: 'Applied Optoelectronics Inc',
    symbol: 'AAOIc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000077',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000006064f8EC027f042294'),
    name: 'American Eagle Outfitters, Inc.',
    symbol: 'AEOc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000033',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000CD7e6b8042cb7c2BB5'),
    name: 'AMC Entertainment Holdings, Inc.',
    symbol: 'AMCc',
    decimals: 8,
    defaultOpeningPrice: '0.00000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000004cc3E96cEb78541d33'),
    name: 'Axon Enterprise, Inc.',
    symbol: 'AXONc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000A640Ec8C1de0EFb484'),
    name: 'AXT Inc',
    symbol: 'AXTIc',
    decimals: 8,
    defaultOpeningPrice: '0.000000001',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000082f7FEA8F2eE8f438'),
    name: 'BJ\'s Wholesale Club Holdings, Inc.',
    symbol: 'BJc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000006',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000eA2df44A307CaB279C'),
    name: 'BitMine Immersion Technologies, Inc.',
    symbol: 'BMNRc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000026',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000024170488e788CBbCb4'),
    name: 'Berkshire Hathaway Inc. Class B',
    symbol: 'BRK.Bc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000801830b13b8E493423'),
    name: 'Beyond Meat, Inc.',
    symbol: 'BYNDc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000086',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000004161B4168d03841511'),
    name: 'Celsius Holdings, Inc.',
    symbol: 'CELHc',
    decimals: 8,
    defaultOpeningPrice: '0.000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000690275843B6e246286'),
    name: 'Cipher Digital Inc.',
    symbol: 'CIFRc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000067',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000055e63C4c1cDC6b7A36'),
    name: 'Clover Health Investments, Corp.',
    symbol: 'CLOVc',
    decimals: 8,
    defaultOpeningPrice: '0.000000013',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000fa63cFFF5c794dbB95'),
    name: 'CleanSpark, Inc.',
    symbol: 'CLSKc',
    decimals: 8,
    defaultOpeningPrice: '0.000000007',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001aaa9010Cd65f82c5E'),
    name: 'Core Scientific, Inc.',
    symbol: 'CORZc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000019f6E7C675b73C2e4D'),
    name: 'Circle Internet Group Inc.',
    symbol: 'CRCLc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000007',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    usdPriceFeed: getAddress('0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000431a5C1E48E3b1d130'),
    name: 'Crocs, Inc.',
    symbol: 'CROXc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000005',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000F111184A74720787E6'),
    name: 'CoreWeave, Inc.',
    symbol: 'CRWVc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000096',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000808E9CCA9ED8e4Da61'),
    name: 'Brinker International, Inc.',
    symbol: 'EATc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000031',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000006b7f6966EE0453E251'),
    name: 'e.l.f. Beauty, Inc.',
    symbol: 'ELFc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000053',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000005A41bef59807119850'),
    name: 'Figure Technology Solutions, Inc.',
    symbol: 'FIGRc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000023',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000006de7888c3FffD803ac'),
    name: 'Galaxy Digital Inc.',
    symbol: 'GLXYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000038',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000F0e13d9C1cdfd211C8'),
    name: 'GoPro, Inc.',
    symbol: 'GPROc',
    decimals: 8,
    defaultOpeningPrice: '0.000000057',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000009a3602cF5d020afA98'),
    name: 'HP Inc.',
    symbol: 'HPQc',
    decimals: 8,
    defaultOpeningPrice: '0.000000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000006Ee1C139a723872e09'),
    name: 'Hut 8 Corp.',
    symbol: 'HUTc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000085',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000004AFF16039bA04bdFBc'),
    name: 'Intel Corporation',
    symbol: 'INTCc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000064',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    usdPriceFeed: getAddress('0xAB657C39bac0D5886250D70849e2E3E008F2EECB'),
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000058F143099d5F79b0ec'),
    name: 'IonQ, Inc.',
    symbol: 'IONQc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000019',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000a63E35E673e3776B88'),
    name: 'Eastman Kodak Company',
    symbol: 'KODKc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000067',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000105A1f43ff3605C5De'),
    name: 'Kohl\'s Corporation',
    symbol: 'KSSc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000028',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000081050Ac3d4395Df527'),
    name: 'Lucid Group, Inc.',
    symbol: 'LCIDc',
    decimals: 8,
    defaultOpeningPrice: '0.00000002',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000eDA6C2c6F11E0F838f'),
    name: 'Lumentum Holdings Inc',
    symbol: 'LITEc',
    decimals: 8,
    defaultOpeningPrice: '0.000000000073',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000d5c0393796E92FCAB0'),
    name: 'Southwest Airlines Company',
    symbol: 'LUVc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000001347ccD9e83d5Bf3e0'),
    name: 'Live Nation Entertainment, Inc.',
    symbol: 'LYVc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000035',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000a310e034E09186Fb2d'),
    name: 'MARA Holdings, Inc.',
    symbol: 'MARAc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000078',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000009188EDFd2FCc8cc81e'),
    name: 'Oklo Inc.',
    symbol: 'OKLOc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000022',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000259694B27Bf052E7d7'),
    name: 'Opendoor Technologies Inc.',
    symbol: 'OPENc',
    decimals: 8,
    defaultOpeningPrice: '0.000000029',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000011b20aebe0Bd567F1c'),
    name: 'Planet Fitness, Inc.',
    symbol: 'PLNTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000C22fFF2785Bb27b39A'),
    name: 'Rigetti Computing, Inc.',
    symbol: 'RGTIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000051',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000bd0C7627b663c581A6'),
    name: 'Riot Platforms, Inc.',
    symbol: 'RIOTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000003e4249C65bd6c037d9'),
    name: 'Rivian Automotive, Inc.',
    symbol: 'RIVNc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000049',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000000D3176ee4af1102d'),
    name: 'Rocket Companies, Inc.',
    symbol: 'RKTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000053',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000004AA2B559CA0a0bbF5D'),
    name: 'Root, Inc.',
    symbol: 'ROOTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000000C1F8aCD3c4496a762'),
    name: 'Sezzle Inc.',
    symbol: 'SEZLc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000045',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000978546Fe604b8dcbC6'),
    name: 'NuScale Power Corporation',
    symbol: 'SMRc',
    decimals: 8,
    defaultOpeningPrice: '0.000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000b8f841940325DB6B2c'),
    name: 'TKO Group Holdings, Inc.',
    symbol: 'TKOc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000034',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000009426B660396eBCf343'),
    name: 'StablecoinX Inc.',
    symbol: 'USDEc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000055',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000979eF4Dd6A001b58b1'),
    name: 'Viking Therapeutics, Inc.',
    symbol: 'VKTXc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000023',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000FEC679b39992F67627'),
    name: 'Valvoline Inc',
    symbol: 'VVVc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000019',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000008fde21a1F5c69FeC0b'),
    name: 'Western Digital Corporation',
    symbol: 'WDCc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000017',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000281C973bf2555dD94B'),
    name: 'Wingstop Inc.',
    symbol: 'WINGc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000432a1d2Bd864ACEc82'),
    name: 'TeraWulf Inc.',
    symbol: 'WULFc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000049',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000089221e238277d52515'),
    name: 'WW International, Inc.',
    symbol: 'WWc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000115bf2283265FB04Db'),
    name: 'Twenty One Capital, Inc.',
    symbol: 'XXIc',
    decimals: 8,
    defaultOpeningPrice: '0.00000001',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000067C8C151f24E1c9924'),
    name: 'Block, Inc.',
    symbol: 'XYZc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000075',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000026215D755356E5043f'),
    name: 'Arm Holdings plc',
    symbol: 'ARMc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000027',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000d2b7D9aeE52F6C6BEf'),
    name: 'Baidu, Inc.',
    symbol: 'BIDUc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000075',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000ca7C6D1438e7245eb6'),
    name: 'Bilibili Inc.',
    symbol: 'BILIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000c36ce081Dd09e86cA2'),
    name: 'Anheuser-Busch InBev SA/NV',
    symbol: 'BUDc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000072',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000f32d61BA597EDdFbfd'),
    name: 'Canaan Inc.',
    symbol: 'CANc',
    decimals: 8,
    defaultOpeningPrice: '0.00000025',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000720133EeDF525f93E2'),
    name: 'Cerebras Systems Inc.',
    symbol: 'CBRSc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000048',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000Ffb10718f880A48274'),
    name: 'Carvana Co.',
    symbol: 'CVNAc',
    decimals: 8,
    defaultOpeningPrice: '0.000000001',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001e838D4bEb66cf8FB7'),
    name: 'Forward Industries, Inc.',
    symbol: 'FWDIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000085',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000005550e8506124236271'),
    name: 'GameSquare Holdings, Inc.',
    symbol: 'GAMEc',
    decimals: 8,
    defaultOpeningPrice: '0.000000023',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000009C52748e1D1Cbd5fd6'),
    name: 'Gemini Space Station, Inc.',
    symbol: 'GEMIc',
    decimals: 8,
    defaultOpeningPrice: '0.000000019',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000f3049F4aa834b23b64'),
    name: 'Hesai Group',
    symbol: 'HSAIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000F6b0417af5F52341FC'),
    name: 'Infosys Limited',
    symbol: 'INFYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000048',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000D61eFD9F54A23ef9eB'),
    name: 'Li Auto Inc.',
    symbol: 'LIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000051',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000005BCdE0a6926919FEF9'),
    name: 'Monster Beverage Corporation',
    symbol: 'MNSTc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000013',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000002D2B5dc53c61f1bA06'),
    name: 'NIO Inc.',
    symbol: 'NIOc',
    decimals: 8,
    defaultOpeningPrice: '0.000000018',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000005ac674f707E357409c'),
    name: 'Nokia Corporation',
    symbol: 'NOKc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000065',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000082Cd2C7801305808Df'),
    name: 'ServiceNow, Inc.',
    symbol: 'NOWc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000041',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000008D5328e9208773dC58'),
    name: 'Novo Nordisk A/S',
    symbol: 'NVOc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000016',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000c8A7223510467D8563'),
    name: 'PDD Holdings Inc.',
    symbol: 'PDDc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000074',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000065ca0F772a5502E976'),
    name: 'Hyperliquid Strategies Inc',
    symbol: 'PURRc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000064',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000cd7dFaef0423F1f103'),
    name: 'Redwire Corporation',
    symbol: 'RDWc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000071',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000e8E50CBbb9a3861a3C'),
    name: 'Rocket Lab Corporation',
    symbol: 'RKLBc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000012',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000017BB66E9301E913A99'),
    name: 'Banco Santander, S.A.',
    symbol: 'SANc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000da6F64c306234127E0'),
    name: 'SAP SE',
    symbol: 'SAPc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000027',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000559eC0BEdaacf436eA'),
    name: 'Sharplink, Inc.',
    symbol: 'SBETc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000075',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000003088798F6d0722AaAC'),
    name: 'Sea Limited',
    symbol: 'SEc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000072',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000b57f99Acec3A7490D0'),
    name: 'Sweetgreen, Inc.',
    symbol: 'SGc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000059',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000187f7071D6E321a7d2'),
    name: 'SK hynix Inc.',
    symbol: 'SKHYc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000043',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000003eF37a7c863DC1482A'),
    name: 'SoFi Technologies, Inc.',
    symbol: 'SOFIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000041',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000a26326a922FFA87f6C'),
    name: 'Sony Group Corporation',
    symbol: 'SONYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000024',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000902F48CBa1f39149F7'),
    name: 'Unity Software Inc.',
    symbol: 'Uc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000349ef3Aa93a0897476'),
    name: 'Unilever Plc',
    symbol: 'ULc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000092',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000063376b142C0764B489'),
    name: 'Vale S.A.',
    symbol: 'VALEc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000008a7508619c717A7106'),
    name: 'Walmart Inc.',
    symbol: 'WMTc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000051',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000e88EFe88D8aDE3f0dA'),
    name: 'WeRide Inc.',
    symbol: 'WRDc',
    decimals: 8,
    defaultOpeningPrice: '0.000000014',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000045beafafBE0Dc7664'),
    name: 'Airbnb, Inc.',
    symbol: 'ABNBc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000034',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000008a494D531D88cF55d6'),
    name: 'Archer Aviation Inc.',
    symbol: 'ACHRc',
    decimals: 8,
    defaultOpeningPrice: '0.000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000072B5C2B2D18Ee8A2a5'),
    name: 'C3.ai, Inc.',
    symbol: 'AIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000052',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000007Cbdf8fa3861E51721'),
    name: 'Applied Digital Corporation',
    symbol: 'APLDc',
    decimals: 8,
    defaultOpeningPrice: '0.000000003',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000006f910a0e7BBD3c168'),
    name: 'AppLovin Corporation',
    symbol: 'APPc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000022',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000cF62D7125cC77D2F96'),
    name: 'Aurora Innovation, Inc.',
    symbol: 'AURc',
    decimals: 8,
    defaultOpeningPrice: '0.000000012',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000747BFfA52Fe2C2510B'),
    name: 'Ball Corporation',
    symbol: 'BALLc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000096',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000898eD394469DB1845C'),
    name: 'BigBear.ai Holdings, Inc.',
    symbol: 'BBAIc',
    decimals: 8,
    defaultOpeningPrice: '0.000000027',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000bC4d895DF1eEeD1d06'),
    name: 'BlackSky Technology Inc.',
    symbol: 'BKSYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000035',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000004EC7c19212979672F9'),
    name: 'Blink Charging Co.',
    symbol: 'BLNKc',
    decimals: 8,
    defaultOpeningPrice: '0.00000014',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000003E5e2892158e25DD7b'),
    name: 'Boot Barn Holdings, Inc.',
    symbol: 'BOOTc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000052',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001ECFAcCd9047D3B544'),
    name: 'Dutch Bros Inc.',
    symbol: 'BROSc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000014',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000001b6e407239EB31EDCf'),
    name: 'CAVA Group, Inc.',
    symbol: 'CAVAc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000011',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001cA01a48688eC7D3CC'),
    name: 'ChargePoint Holdings, Inc.',
    symbol: 'CHPTc',
    decimals: 8,
    defaultOpeningPrice: '0.000000008',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000A5E12a1842DfcDb118'),
    name: 'Chewy, Inc.',
    symbol: 'CHWYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000028',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000A8C925F62e6D194715'),
    name: 'Coherent Corp.',
    symbol: 'COHRc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000026',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000bf391678bf2e38CedB'),
    name: 'DoorDash, Inc.',
    symbol: 'DASHc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000031',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000CC17EEa8c9495E1499'),
    name: 'Ginkgo Bioworks Holdings, Inc.',
    symbol: 'DNAc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000059',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000007a90b2D9Ed101035A8'),
    name: 'Enphase Energy, Inc.',
    symbol: 'ENPHc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000019',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000ee6fD7De967ea1A0DC'),
    name: 'National Beverage Corp.',
    symbol: 'FIZZc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000017',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000004fc7a0C25178A0D633'),
    name: 'Firefly Aerospace Inc.',
    symbol: 'FLYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000037',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000b096f2f6021Ac39617'),
    name: 'First Solar, Inc.',
    symbol: 'FSLRc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000035',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000F327a373aa86Ac86A8'),
    name: 'The Hershey Company',
    symbol: 'HSYc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000036',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000077D13D6c79B6C11c5A'),
    name: 'ImmunityBio, Inc.',
    symbol: 'IBRXc',
    decimals: 8,
    defaultOpeningPrice: '0.000000007',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000B44f193b3fFdF17037'),
    name: 'Jack in the Box Inc.',
    symbol: 'JACKc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000049',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000fab55ad3773F2c8eF1'),
    name: 'Centrus Energy Corp.',
    symbol: 'LEUc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000054',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000db15c02E133a9dAB99'),
    name: 'LifeMD, Inc.',
    symbol: 'LFMDc',
    decimals: 8,
    defaultOpeningPrice: '0.000000026',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000C3e498043bb44E8CbF'),
    name: 'The Lovesac Company',
    symbol: 'LOVEc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000042',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000674E1325DBdF06B309'),
    name: 'Intuitive Machines, Inc.',
    symbol: 'LUNRc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000056',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000d2f4cf2f7DEBB244BB'),
    name: 'McDonald\'s Corporation',
    symbol: 'MCDc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000024',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000069d694d397b9388dAC'),
    name: 'NANO Nuclear Energy Inc.',
    symbol: 'NNEc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000e7137cA231c5e35f25'),
    name: 'Ondas Inc.',
    symbol: 'ONDSc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000097',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000003086b1355bd43e25Da'),
    name: 'Offerpad Solutions Inc.',
    symbol: 'OPADc',
    decimals: 8,
    defaultOpeningPrice: '0.000000025',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB20000000000000000000087d144F2C70cd1A5F6'),
    name: 'Dave & Buster’s Entertainment, Inc.',
    symbol: 'PLAYc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000075',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB200000000000000000000cB6B2f4e33f0471556'),
    name: 'Planet Labs PBC',
    symbol: 'PLc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000045',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000068987dacde1dB79Cd4'),
    name: 'Papa John’s International, Inc.',
    symbol: 'PZZAc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000032',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000bD938fa95e3E20c5A1'),
    name: 'QuantumScape Corporation',
    symbol: 'QSc',
    decimals: 8,
    defaultOpeningPrice: '0.000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000000F28146Eb28ea2835B'),
    name: 'RUM Group Inc.',
    symbol: 'RUMc',
    decimals: 8,
    defaultOpeningPrice: '0.00000001',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000b1b9200405Fb52A8cF'),
    name: 'Sunrun Inc.',
    symbol: 'RUNc',
    decimals: 8,
    defaultOpeningPrice: '0.000000008',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000501Ef81F911eB57656'),
    name: 'Recursion Pharmaceuticals, Inc.',
    symbol: 'RXRXc',
    decimals: 8,
    defaultOpeningPrice: '0.000000016',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000e410ae30ABDdA3Aee0'),
    name: 'The Boston Beer Company, Inc.',
    symbol: 'SAMc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000033',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000000D9947c759429e7fE5'),
    name: 'SharonAI Holdings Inc.',
    symbol: 'SHAZc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000022',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000002B9AC07a0544688079'),
    name: 'Sidus Space, Inc.',
    symbol: 'SIDUc',
    decimals: 8,
    defaultOpeningPrice: '0.000000052',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000dF3EB2AF7316B29122'),
    name: 'Solid Power, Inc.',
    symbol: 'SLDPc',
    decimals: 8,
    defaultOpeningPrice: '0.00000003',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001409f816682b7772b7'),
    name: 'The Simply Good Foods Company',
    symbol: 'SMPLc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000055',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000001AC12227a8aE0Ef3Ac'),
    name: 'Constellation Brands, Inc.',
    symbol: 'STZc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000046',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb2000000000000000000003FE90a64263B7F9E74'),
    name: 'Smith & Wesson Brands, Inc.',
    symbol: 'SWBIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000041',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000e0B9460c97F38f412F'),
    name: 'Molson Coors Beverage Company',
    symbol: 'TAPc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000015',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000008baF7bb82e4C37743f'),
    name: 'The Trade Desk, Inc.',
    symbol: 'TTDc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000048',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000879A74C76C73a27d71'),
    name: 'Under Armour, Inc.',
    symbol: 'UAAc',
    decimals: 8,
    defaultOpeningPrice: '0.000000013',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000cAE20cb1446462e24c'),
    name: 'Uber Technologies, Inc.',
    symbol: 'UBERc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000087',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000c367d37d07150182A2'),
    name: 'UnitedHealth Group Incorporated',
    symbol: 'UNHc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000014',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb20000000000000000000089BC72C3E637a02AdB'),
    name: 'Wayfair Inc.',
    symbol: 'Wc',
    decimals: 8,
    defaultOpeningPrice: '0.00000000053',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000DfA6C77AEa5329D187'),
    name: 'Workhorse Group Inc.',
    symbol: 'WKHSc',
    decimals: 8,
    defaultOpeningPrice: '0.000000023',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000008Df9Bc22Db1d7dA2a5'),
    name: 'Wolfspeed, Inc.',
    symbol: 'WOLFc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000025',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xb200000000000000000000613C15F118DF2b189B'),
    name: 'YETI Holdings, Inc.',
    symbol: 'YETIc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000014',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    token: getAddress('0xB2000000000000000000005C8324136dE0f4134a'),
    name: 'YUM! Brands, Inc.',
    symbol: 'YUMc',
    decimals: 8,
    defaultOpeningPrice: '0.0000000004',
    supportsEthDevBuy: false,
    riskLabel: 'admin-controlled-b20-stock',
    v3Only: true,
  },
]

/**
 * Deployed pair-bound auction modules, keyed by `launchPairKey(chainId, token)`.
 *
 * Every address here was read back from the launcher's own allowlist
 * (`mevModuleEnabled(module) == true` and `pairedTokenEnabled(token) == true`)
 * on Base mainnet at block 50,974,454, 2026-09-07, together with the locker's
 * `feeSourceEnabled(module)` and the module's own immutable `pairedToken()`.
 * A pair is listed only once all of those agree, so this record is the
 * launchable set, not an intention.
 *
 * COINc deliberately has no module here. Its facts are checked in so the wiring
 * is ready the day the issuer mints supply, but `defaultLaunchPairs` omits it
 * until a module exists, which is the same thing the chain would tell you.
 *
 * These are defaults, not a lock-in: `resolveLaunchPairs` still takes an
 * arbitrary module map, which is what a fork, a private deployment, or a
 * cutover window needs.
 *
 * Base Sepolia has no entry. Its pre-v2.1 unbound module was disabled and no
 * pair-bound module has been deployed to replace it, so the chain currently has
 * no launchable pair — `defaultLaunchPairs(BASE_SEPOLIA_CHAIN_ID)` is empty by
 * design rather than by omission.
 */
export const DEFAULT_LAUNCH_PAIR_MODULES: Readonly<Record<LaunchPairKey, string>> = {
  [launchPairKey(BASE_MAINNET_CHAIN_ID, BASE_WETH)]:
    '0x72BD22136b321ea321573828E00120B016CE3967',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb2000000000000000000002d0ba3164cc74f58b7')]:
    '0xe6A1f39b642Fb27BF400D10428135551e1dd5fa4',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb200000000000000000000C2e324d24d7eEcd1fb')]:
    '0x5f1e5e728CEA9296a65e69AAf1246414708d3712',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb20000000000000000000078ee7ce2fE4908108C')]:
    '0xC52b2a85B28736E9550EFF553c95fC3D5595978E',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb2000000000000000000008bC8786B856E61707C')]:
    '0x5db77e41fD36236559608110d90fFA926A24d424',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb200000000000000000000d9192b6B456483C2E8')]:
    '0x115CFa0A84fEDc6471f18193815D07b8Ac83482B',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xB200000000000000000000Ab99cFa739E253872B')]:
    '0xe6CebF8aC9839c0aEc02Bbcf30315C2C760FeBC3',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb2000000000000000000004884b426556b92883d')]:
    '0x8F13223B51D52D2cDb4a64B6E6927F90b1fC10Bd',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb200000000000000000000397293Cb8cda9a10c5')]:
    '0xE840EbdE0397575c17980336f9352c2b09141CCA',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb2000000000000000000007b9fcbd005511aCBd5')]:
    '0x3CF0A959E57bA91dCA442f020cd355b9eFb50247',
  [launchPairKey(BASE_MAINNET_CHAIN_ID, '0xb2000000000000000000001e800a7f5189430cD0')]:
    '0x8aF1a3D862FBC6625a52EE8e7fB01aeDa397f7B4',
}

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
  const drafts = LAUNCH_PAIR_FACTS.filter((f) => f.chainId === chainId && !f.v3Only).map((f) => ({
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

/**
 * The curated pairs for `chainId` bound to their currently deployed modules.
 *
 * The zero-configuration path: it is `resolveLaunchPairs` with
 * `DEFAULT_LAUNCH_PAIR_MODULES`. Pass your own map instead when you run against
 * a fork or a private deployment.
 *
 * Allowlists change by owner transaction, so a shipped default can go stale
 * between releases. Anything long-lived should still gate on chain state with
 * `selectLiveLaunchPairs`.
 */
export function defaultLaunchPairs(chainId: number): LaunchPairConfig[] {
  return resolveLaunchPairs(chainId, DEFAULT_LAUNCH_PAIR_MODULES)
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
