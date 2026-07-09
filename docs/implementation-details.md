# Implementation Details

This is a standalone launcher integration SDK, consumed by products that want to
offer RWAGMI B20 launches without embedding the RWAGMI web app.

## Package Layout

```text
src/
  abi/                 Contract ABIs needed by launch, receipt parsing, errors
  launch/              Address resolution, config builder, ticks, receipt parser
  chains.ts            Base mainnet and Base Sepolia metadata helpers
  constants.ts         B20 precompiles and token constants
  create.ts            Minimal B20 Asset create-param and address helpers
  deployments.ts       Current public launcher stack constants
  errors.ts            B20/RWAGMI custom error decoding
  integration.ts       High-level prepareRwagmiLaunch helper
  launch-writes.ts     Post-launch reward transaction builders
  roles.ts             B20 role hashes used in readable errors
  tx-plan.ts           Reviewable transaction plan helpers
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

The sniper auction module can also credit WETH into the locker reward ledger.
Use the post-launch helpers in `launch-writes.ts` to collect and claim reward
balances.

## Optional ETH Dev Buy

Set `draft.devBuyEth` to attach ETH to the launch transaction and invoke the
allowlisted `RwagmiEthDevBuy` extension.

When enabled:

- `addresses.devBuyExtension` must be configured
- transaction `value` equals the sum of extension `msgValue`
- `devBuyRecipient` defaults to `creatorRecipient`
- `devBuyAmountOutMinimum` defaults to `0n`

The extension wraps ETH to WETH and buys the new B20 through the launch pool.

## Transaction Plans

Every write returns `PreparedB20Write`.

```ts
{
  kind,
  label,
  chainId,
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
- launcher allowlist errors
- dev-buy slippage and settlement errors
- AMM-safety guard failures

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
