# Changelog

All notable changes to this package are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - Unreleased

Launcher v3: one token across 1–5 Uniswap v4 pools, with trading fees taken in
each pool's paired asset. V2 launches and their claims are unchanged.

### Added

- `DEFAULT_LAUNCHER_V3` and `defaultLauncherV3(chainId)`: the launcher v3 stack
  on Base mainnet (launcher, hook, locker, ETH creator-buy extension, indexer
  start block).
- Launch building: `buildLaunchV3Config`, `previewLaunchV3`, `prepareLaunchV3`,
  `preflightLaunchV3`, `STATIC_FEE_V3`, `DYNAMIC_FEE_V3`, and
  `validateHookFeeV3`.
- `readLaunchPairsV3(client, deployment, candidates?)`: the pairs the launcher
  accepts, with symbol and decimals read onchain, in two Multicall3 requests.
- `quoteLaunchDevBuyV3`: an exact creator-buy quote from a full-launch
  simulation.
- Receipts: `parseLaunchV3Receipt`, and `parseLaunchV3Receipts` for transactions
  that batch several launches.
- Rewards: `readLaunchFeesV3`, `prepareClaimQuoteV3`, and
  `prepareRewardRotationV3`.
- Fee, price, and pool maths: `quoteFeeV3`, `priceToTickV3`, `priceAtTickV3`,
  `allocateV3Supply`, `decimalRational`, `divideRational`, `formatRational`,
  `buildPoolKey`, and `poolIdV3`; and `validateLauncherRegistry` and
  `findLauncherDeployment` for keeping several deployments.
- ABIs: `rwagmiLauncherV3Abi`, `rwagmiHookV3Abi`, `rwagmiLpLockerV3Abi`, and
  `rwagmiEthDevBuyV3Abi`. `decodeB20Error` explains the v3 errors and unwraps
  Uniswap v4's `WrappedError`.
- Pair catalogue: the rest of Coinbase's tokenized-stock catalogue, 174 more
  stocks, listed as facts the v3 launcher accepts. No v2 auction module ships
  for them, so `defaultLaunchPairs` still offers the same v2 pairs. The new
  `LaunchPairConfig.v3Only` flag marks the 57 with no v2 module at all, and
  `resolveLaunchPairs` never resolves those for a v2 launch.
- `ReadClient`: the client methods the SDK calls.
- `examples/launch-v3.ts`.

### Changed

- `validateLiquidityCurve` takes an optional sixth argument, `enforcePrecision`
  (default `true`). The v3 builder turns it off because the v3 locker records
  supply a curve cannot place as a locked remainder.

### Fixed

- Every function that takes a client now accepts `ReadClient` instead of
  `PublicClient`, so a client created with `chain: base` type-checks without a
  cast. Base's OP-stack formatters made such a client unassignable to a plain
  `PublicClient` under current viem. Any `PublicClient` still satisfies
  `ReadClient`.

## [0.2.0] - Unreleased

Launcher v2.1: pair-bound auction modules, curated launch pairs, and a
liquidity-precision guard.

### Breaking

- `BuildLaunchArgs` now requires a `pair: LaunchPairConfig`. The pair — not the
  draft — decides the paired token, its decimals, the auction module, and
  dev-buy eligibility. A draft that disagrees with it throws rather than
  silently preferring one.
- `LauncherAddresses.mevModule` is optional, deprecated, and no longer present
  in `DEFAULT_LAUNCHER_ADDRESSES`. The launch builder ignores it; the module
  comes from the selected pair. Use `defaultWethLaunchPair(chainId)`.
- `legacyWethLaunchPair(chainId)` always returns null and will be removed. The
  v2.1 cutover removed the pre-v2.1 unbound module from the launcher's
  allowlist on both Base mainnet and Base Sepolia, so the pair it returned
  produced a launch that reverted with `MevModuleNotEnabled`. Returning null
  fails in caller code instead of on-chain after the user has signed.
- `draft.pairedDecimals` no longer defaults to 18. It is read from the pair, and
  a stale draft value is rejected. The old fallback mis-scaled every
  non-18-decimal pair by `10 ** (18 - decimals)` — a factor of 10^10 for the
  8-decimal B20 stocks.
- `devBuyAmountOutMinimum` is required for any dev buy and must be a positive
  `uint128`; it no longer defaults to `0n`. `encodeDevBuyData` requires it too.
- `validateLiquidityCurve` takes the pool supply as a fifth argument.
- `ClaimLaunchRewardsCtx` requires `token`, the launch token the reward balance
  belongs to.
- `PreparedB20Write` gains a required `subjectToken` field, which
  `prepareWrite` defaults to `to`. It names the token whose product surface owns
  the action, for callers that scope local history by token.

### Added

- Curated launch pair registry (`resolveLaunchPairs`, `defaultLaunchPair`,
  `launchPairFrom`, `launchPairFactsFor`, `launchPairKey`, `isWethPair`)
  covering canonical WETH and eleven Base tokenized stocks, each with its own
  pair-bound module, decimals, default opening price, risk label, and Chainlink
  USD feed.
- `selectLiveLaunchPairs` narrows the build-time list to what the launcher
  currently accepts, with a legacy-module fallback for WETH during cutover.
- `evaluatePairPreflight` refuses a paired token with no deployed bytecode,
  whose LP fees could never be claimed out of the locker.
- Liquidity precision guard: `launch/liquidity-math.ts` (exact bigint ports of
  `TickMath`, `LiquidityAmounts`, and `SqrtPriceMath`, checked against a table
  generated from Solidity), `strandedSupplyForCurve`, and `MAX_STRANDED_PPB`.
  `validateLiquidityCurve` now rejects opening prices that would strand launch
  supply unrecoverably in the locker, or overflow a `uint128` outright.
- `alignedStartingPrice` returns the tick that will actually execute and its
  human price, so a UI can show the executed opening price rather than the
  requested one.
- `quoteLaunchDevBuy` quotes an exact creator buy by sentinel simulation, and
  `minimumOutForSlippage` applies a tolerance to it.
- Offline B20 address derivation and vanity salt mining (`computeB20Address`,
  `mineVanityB20Salt`, `B20_VANITY_SUFFIX`).
- `rwagmiPairBoundSniperAuctionV1Abi` and `chainlinkAggregatorV3Abi`.
- `DEFAULT_LAUNCH_PAIR_MODULES`: the deployed pair-bound auction modules, each
  read back from the launcher's own `mevModuleEnabled` / `pairedTokenEnabled`
  allowlist on Base mainnet at block 50,974,454 (2026-09-07), cross-checked
  against the locker's `feeSourceEnabled` and the module's own immutable
  `pairedToken()`. Every pair but COINc is launchable: WETH plus the ten minted
  stocks (GOOGLc, AAPLc, NVDAc, METAc, AMZNc, MSFTc, MSTRc, SNDKc, SPCXc,
  TSLAc). COINc is still unminted, so it has no module and `defaultLaunchPairs`
  omits it. Base Sepolia has no entry either: its unbound module was disabled
  with no pair-bound replacement deployed, so the chain has no launchable pair.
- `defaultLaunchPairs(chainId)` and `defaultWethLaunchPair(chainId)` resolve the
  curated pairs against those modules, so a launch needs no module
  configuration. `resolveLaunchPairs(chainId, modules)` still takes an arbitrary
  map for forks and private deployments.

### Changed

- `decodeB20Error` recognises wallet rejections (provider code 4001/5000,
  `UserRejectedRequestError`, and rejection phrasing anywhere in the cause
  chain) and returns `Transaction cancelled in wallet.`, and strips viem's
  `Request Arguments` / `Raw Call Arguments` / `Version:` dumps from other
  user-facing messages.
- `decodeB20Error` explains the pair-binding reverts: `PairedTokenNotInPool`,
  `PairedTokenMismatch`, `UnexpectedMevModuleData`, `InvalidAuctionParams`,
  `NotLockerFeeSource`, `AuctionParamsNotConfigured`, and
  `PairedTokenMustBeWeth`.
- `prepareLaunchB20` warns with the exact ETH attached and minimum tokens
  required for a creator buy.
- `prepareCreateB20` warns explicitly when the token is created with no
  `DEFAULT_ADMIN_ROLE`.
- Dev buy is refused on any pair but canonical WETH, rather than building a
  transaction that reverts with `PairedTokenMustBeWeth`.
- The README documents launching against a local Base mainnet fork, including
  why it needs `base-anvil`: B20 tokens and their factory are native to the Base
  node, so stock `anvil` sees no factory code and fails any B20 call with
  `OpcodeNotFound`.

## [0.1.0] - Unreleased

Initial public release.

- `prepareRwagmiLaunch` one-call launch preparation: predicts the B20 address,
  builds the typed `LaunchConfig`, and returns a reviewable transaction plan plus
  a raw transaction request.
- `buildLaunchConfig`, tick/liquidity helpers, and one-sided launch range math.
- Optional ETH dev-buy extension support.
- Launch receipt parsing (`parseLaunchReceipt`).
- Post-launch reward helpers (collect, claim, rotate recipient/admin).
- B20 / RWAGMI custom error decoding.
- Current Base mainnet and Base Sepolia launcher-stack deployment constants.
