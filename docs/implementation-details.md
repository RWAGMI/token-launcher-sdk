# Implementation Details

This is a standalone launcher integration SDK, consumed by products that want to
offer RWAGMI B20 launches without embedding the RWAGMI web app.

## Package Layout

```text
src/
  abi/                 Contract ABIs needed by launch, receipt parsing, errors
  launch/
    addresses.ts       Launcher-stack address resolution
    pairs.ts           Curated launch pair registry (paired token + its module)
    live-pairs.ts      Narrow the registry to what the launcher accepts now
    pair-preflight.ts  Paired-token bytecode check before spending money
    ticks.ts           Tick math, liquidity shapes, and the stranding guard
    liquidity-math.ts  Exact bigint ports of the Solidity mint math
    config.ts          LaunchConfig builder
    dev-buy-quote.ts   Exact creator-buy quote via sentinel simulation
    receipt.ts         Launch receipt parser
  chains.ts            Base mainnet and Base Sepolia metadata helpers
  constants.ts         B20 precompiles and token constants
  create.ts            Minimal B20 Asset create-param and address helpers
  deployments.ts       Current public launcher stack constants
  errors.ts            B20/RWAGMI custom error decoding
  integration.ts       High-level prepareRwagmiLaunch helper
  launch-writes.ts     Post-launch reward transaction builders
  roles.ts             B20 role hashes used in readable errors
  tx-plan.ts           Reviewable transaction plan helpers
  vanity.ts            Offline B20 address derivation and vanity salt mining
```

The only runtime dependency is `viem`.

## Launch Preparation Model

The high-level integration path is `prepareRwagmiLaunch(args)`.

Internally it:

1. Converts the `LaunchDraft` into the B20 Asset create input.
2. Calls the B20Factory precompile's `getB20Address(ASSET, launcher, salt)`.
3. Builds the typed `LaunchConfigStruct`.
4. Wraps that config in a `PreparedB20Write`.
5. Encodes a plain raw transaction request.

The predicted token address matters because Uniswap v4 sorts currencies by
address. The config builder needs to know whether the new B20 will be currency0
or currency1 so it can place one-sided liquidity on the correct side of the
starting tick.

## LaunchConfig Construction

`buildLaunchConfig` is pure and deterministic. It does not read chain state.
The caller supplies:

- `chainId`
- deployed launcher-stack addresses
- RWAGMI reward-slot config
- launch draft form state
- predicted B20 token address
- the curated `pair` this launch uses

The builder validates:

- variant is `asset`
- decimals are 6 through 18
- pool supply is positive
- LP fee is 1% through 100%, encoded as hundredths of a bip
- custom liquidity curves have matching arrays
- position bps sum to 10000
- there are no more than 7 positions
- ticks are aligned to the fixed launch tick spacing
- liquidity is entirely on the B20 side of the starting tick
- the mint will not strand a meaningful share of the launch supply
- the draft's paired token and decimals agree with the selected pair
- a creator dev buy is only attached to the WETH pair

## Launch Pairs Are Pair-Bound

From launcher v2.1 the MEV auction module is **bound to one paired token**. Its
immutable `pairedToken()` must equal the pool's paired token or the launch
reverts, so there is no such thing as a default module.

`launch/pairs.ts` holds the curated registry: for each approved pair, the token,
its decimals, the module bound to it, whether ETH dev buy is available, a
default opening price, a risk label, and (for the tokenized stocks) a Chainlink
USD feed. Module addresses are deployment inputs rather than source constants —
supply them to `resolveLaunchPairs(chainId, modules)`, keyed by
`launchPairKey(chainId, token)`. A pair with no configured module is dropped,
and a configuration with no WETH pair is rejected outright, because every
product default in this SDK is written for WETH.

`LauncherAddresses.mevModule` is retained but deprecated. The launch builder
never reads it. It exists so existing deployment records keep type-checking, and
so `legacyWethLaunchPair(chainId)` can reproduce the single WETH pair the
deployed launcher accepts today, while the pair-bound modules are still
undeployed.

`selectLiveLaunchPairs(pairs, state, legacy)` narrows the build-time list to
what the launcher currently accepts, given `mevModuleEnabled` and
`pairedTokenEnabled` read from chain. Passing `null` state returns the list
unchanged, so an RPC failure degrades to the build-time config rather than
emptying your launch form.

`evaluatePairPreflight(pair, bytecode)` refuses a paired token with no deployed
code. The locker pays LP fees with OpenZeppelin `SafeERC20`, which reverts
against a code-less account — so such a pool would be tradeable but its fees
permanently unclaimable, on both sides.

## Liquidity Precision

`placeLiquidity` converts each position's allocation into a v4 liquidity number,
and the pool then charges only what that liquidity is worth. Both steps
truncate, and the remainder is never refunded: it sits in the locker with no way
out. At an extreme opening price the mint places *zero* liquidity, producing an
untradeable pool holding none of its supply.

The locker and launcher are deployed and cannot be changed, so the SDK is the
only place this can be caught. `launch/liquidity-math.ts` is an exact bigint
port of `TickMath`, `LiquidityAmounts`, and `SqrtPriceMath` (rounding up, as the
pool charges), checked against a table generated from the real Solidity
libraries. `strandedSupplyForCurve` walks the same allocation the locker walks
and sums the exact shortfall; `validateLiquidityCurve` rejects any curve that
would strand more than `MAX_STRANDED_PPB` (1 part per billion) of the supply.

Both token orientations are computed, not modelled. A one-sided B20 position
takes the amount0 path when the B20 sorts as currency0 and the amount1 path when
it sorts as currency1, and roughly half of launches take each — a launch token
and a B20 stock share an address prefix and sort against each other on a hash.

## Token Bootstrap Modes

Immutable mode:

- sets `initialAdmin = address(0)`
- only includes metadata init calls when a contract URI is supplied
- relies on the launcher-authored immutable bootstrap path

Admin mode:

- sets `initialAdmin` to the creator admin
- mints the launch pool supply to the launcher during bootstrap
- leaves live B20 admin powers after launch

Products should make this distinction visible. Admin mode can later grant Asset
operator power and update rebase behavior, so it is materially riskier than
immutable mode.

## Liquidity Geometry

Launch pools use Uniswap v4 ticks. `initialPrice` is the human paired-token
amount per 1 B20. The SDK folds decimals into the raw price and converts it to
the v4 tick:

```text
tick = floor(log(rawPrice) / log(1.0001))
```

The current launcher uses fixed tick spacing `200`. Built-in liquidity shapes:

- `Standard`: one position
- `Project`: five overlapping positions
- `Custom`: caller-supplied arrays, still validated by the SDK

The launcher's one-sided B20 position can be on either side of the pool tick
depending on token sorting. The SDK mirrors ranges when the B20 sorts as
currency1.

## Rewards And Fees

The default launch reward split is:

- 90% creator
- 10% RWAGMI

This split applies to launch LP position fees. It is not an extra swap fee.
Reward bps are immutable after launch. A reward admin can rotate only its own
recipient or admin slot.

The pair's auction module can also credit the paired token into the locker
reward ledger.
Use the post-launch helpers in `launch-writes.ts` to collect and claim reward
balances.

## Optional ETH Dev Buy

Set `draft.devBuyEth` to attach ETH to the launch transaction and invoke the
allowlisted `RwagmiEthDevBuy` extension.

When enabled:

- the selected pair must be canonical WETH; `RwagmiEthDevBuy` reverts with
  `PairedTokenMustBeWeth` on any other pair, so the SDK refuses to build it
- `addresses.devBuyExtension` must be configured and non-zero
- transaction `value` equals the sum of extension `msgValue`
- `devBuyRecipient` defaults to `creatorRecipient`, and must be non-zero
- `devBuyAmountOutMinimum` is **required** and must be a positive `uint128`

The extension wraps ETH to WETH and buys the new B20 through the launch pool.

A required minimum output means you need a quote. `quoteLaunchDevBuy` simulates
the complete launch with `uint128.max` as the minimum, which `RwagmiEthDevBuy`
cannot satisfy: it reverts with `DevBuySlippage(minimum, actual)`, and `actual`
is the exact output from the same pool initialization, liquidity curve, LP fee,
and extension path the wallet will later sign. Apply a tolerance with
`minimumOutForSlippage(amountOut, slippageBps)`.

## Transaction Plans

Every write returns `PreparedB20Write`.

```ts
{
  kind,
  label,
  chainId,
  subjectToken,
  to,
  abi,
  functionName,
  args,
  value,
  riskLevel,
  warnings,
  requiresExplicitConfirm
}
```

Use `toWriteContractArgs(plan)` for wagmi-style `writeContract`. Use
`toTransactionRequest(plan)` for wallet clients that submit a raw transaction.
Both encode normal ABI calldata.

## Error Handling

Use `decodeB20Error(error)` for thrown viem errors and `decodeRevertData(data)`
for raw revert bytes.

The decoder covers:

- AccessControl role failures
- B20 policy failures
- launch auction errors such as `NotAuctionBlock`
- pair-binding errors such as `PairedTokenNotInPool` and `PairedTokenMismatch`
- launcher allowlist errors
- dev-buy slippage and settlement errors
- AMM-safety guard failures
- wallet rejections, collapsed to `Transaction cancelled in wallet.`

Unknown custom errors fall back to `Reverted with <name>`.

## Host App Responsibilities

The host product should provide:

- wallet connection and chain switching
- form validation and amount parsing
- metadata upload, if using contract URI
- simulation and explicit confirmation UX
- transaction submission through the user's wallet
- receipt storage and indexing
- explorer links and post-launch navigation

The SDK intentionally does not run a database or indexer. If your product needs
a launch browser or swap route, index `B20TokenCreated` events from the
launcher and store the returned pool metadata.

## Vanity Token Addresses

B20Factory addresses are derived as:

```text
token = 0xB20 | 18 zero nibbles | variant nibble | keccak256(abi.encode(sender, salt))[0..9]
```

Only the trailing 18 nibbles carry entropy, so `mineVanityB20Salt` can search
offline with plain keccak instead of `getB20Address` RPC calls — a 3-nibble
suffix costs ~4096 tries. The derivation is protocol-sealed but undocumented, so
always confirm the mined salt with `predictB20Address` (chain truth) before
submitting. A derivation change then degrades to a non-vanity address rather
than a wrong deployment.
