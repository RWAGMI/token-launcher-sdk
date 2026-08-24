# RWAGMI Token Launcher SDK

Standalone TypeScript SDK for integrating the RWAGMI B20 token launcher into an
external product.

This package prepares wallet-reviewable transactions for launching a new Base
B20 Asset token into a RWAGMI Uniswap v4 pool. It does not custody keys, submit
transactions for the user, run an indexer, or depend on the RWAGMI web app.

## What This SDK Does

- Builds the `RwagmiB20Launcher.launchB20(config)` transaction.
- Predicts the B20 token address before launch through the B20Factory
  precompile, and can mine a vanity salt for it offline.
- Encodes immutable or admin-mode Asset token bootstrap calls.
- Builds the one-sided Uniswap v4 launch liquidity ranges, and refuses opening
  prices that would strand launch supply unrecoverably in the locker.
- Resolves the curated launch pairs and their pair-bound auction modules.
- Supports the optional ETH dev-buy extension, including an exact quote.
- Parses the launch receipt into token, pool, hook, locker, and reward details.
- Prepares post-launch reward collection, claiming, and reward-slot rotation
  transactions.
- Decodes common B20 and RWAGMI custom errors into product-facing messages.

## What This SDK Does Not Do

- It does not store or request private keys.
- It does not create arbitrary ERC20 pairs or act as a swap aggregator.
- It does not launch B20 Stablecoins. Current RWAGMI launcher scope is B20 Asset
  tokens only.
- It does not let you launch against an arbitrary paired token. Pairs are a
  curated, source-controlled registry and the launcher allowlists them on-chain.
- It does not bypass wallet review. Every write is returned as a transaction
  plan for your app to display, simulate, and submit through the user's wallet.

## Install

```bash
pnpm add @rwagmi/token-launcher-sdk viem
```

`viem` (>= 2.52) is a peer dependency, so install it alongside the SDK.

## Quick Start

```ts
import {
  BASE_MAINNET_CHAIN_ID,
  DEFAULT_LAUNCHER_ADDRESSES,
  DEFAULT_RWAGMI_FEE_CONFIG,
  legacyWethLaunchPair,
  parseLaunchReceipt,
  prepareRwagmiLaunch,
  randomSalt,
  toWriteContractArgs,
} from '@rwagmi/token-launcher-sdk'
import { createPublicClient, http, parseUnits, type Address } from 'viem'
import { base } from 'viem/chains'

const chainId = BASE_MAINNET_CHAIN_ID
const addresses = DEFAULT_LAUNCHER_ADDRESSES[chainId]
const rwagmiFee = DEFAULT_RWAGMI_FEE_CONFIG[chainId]

// Every launch needs a pair. See "Launch Pairs" below for the registry path;
// this is the single WETH pair the deployed launcher accepts today.
const pair = legacyWethLaunchPair(chainId)!

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
})

const creator = '0xYourCreatorWallet' as Address

const prepared = await prepareRwagmiLaunch({
  client: publicClient,
  chainId,
  addresses,
  rwagmiFee,
  pair,
  draft: {
    variant: 'asset',
    name: 'Example Token',
    symbol: 'EXAMP',
    decimals: 18,
    salt: randomSalt(),
    poolSupply: parseUnits('1000000', 18),
    creatorRecipient: creator,
    creatorAdmin: creator,
    pairedToken: pair.token,
    initialPrice: 0.000001,
    initialAdmin: creator,
    adminMode: 'immutable',
    liquidityShape: 'Standard',
  },
})

console.log('Predicted token:', prepared.predictedToken)
console.log('Warnings:', prepared.plan.warnings)

// wagmi writeContract path
const writeArgs = toWriteContractArgs(prepared.plan)
// writeContract(writeArgs)

// raw transaction path
// walletClient.sendTransaction({
//   account,
//   ...prepared.transactionRequest,
// })

// After the tx is mined:
// const receipt = await publicClient.waitForTransactionReceipt({ hash })
// const launch = parseLaunchReceipt(receipt, addresses.launcher)
```

## Integration Flow

1. Connect the user's wallet and enforce Base mainnet or Base Sepolia.
2. Resolve or configure the launcher stack addresses for the active chain.
3. Resolve the launch pairs for that chain and let the user pick one. Seed the
   opening price from the chosen pair's `defaultOpeningPrice`, and clear it when
   the pair changes — a WETH-denominated price is meaningless against an
   8-decimal stock.
4. Collect the remaining launch form inputs: name, symbol, decimals, metadata
   URI, supply, opening price, reward recipient, reward admin, and admin mode.
5. Convert human amounts to base units with `parseUnits`.
6. For a creator dev buy, quote it with `quoteLaunchDevBuy` and set
   `devBuyAmountOutMinimum` from `minimumOutForSlippage`.
7. Call `prepareRwagmiLaunch`.
8. Render `prepared.plan` for review, including `to`, `functionName`, `value`,
   risk level, and warnings.
9. Simulate the call if your wallet stack supports simulation.
10. Submit with `writeContract(toWriteContractArgs(prepared.plan))` or
    `sendTransaction(prepared.transactionRequest)`.
11. Parse the mined receipt with `parseLaunchReceipt`.
12. Store the returned token address and pool details in your product.

## Required Configuration

The SDK ships with current public deployment constants:

- `DEFAULT_LAUNCHER_ADDRESSES[8453]` for Base mainnet.
- `DEFAULT_LAUNCHER_ADDRESSES[84532]` for Base Sepolia.
- `DEFAULT_RWAGMI_FEE_CONFIG[chainId]` for RWAGMI's 10% launch LP-fee reward
  slot.
- `BASE_WETH` for the canonical Base WETH pair token.
- `LAUNCH_PAIR_FACTS` for the curated pair facts (token, decimals, default
  opening price, risk label, USD feed).

Pair-bound auction module addresses are deliberately **not** shipped as
constants — they are deployment inputs you pass to `resolveLaunchPairs`, so a
pair you have not configured cannot be launched against by accident.

For production apps, keep these values in your own runtime config so you can
upgrade without rebuilding this SDK.

## Launch Pairs

Every launch is built against a `LaunchPairConfig` from the curated registry in
`launch/pairs.ts`. The pair — not the draft — decides the paired token, its
decimals, the auction module, and whether a creator dev buy is available.

From launcher v2.1 each approved pair has its **own** auction module, whose
immutable `pairedToken()` must match the pool. There is no default module:
a mismatched pair/module combination reverts on-chain, so the SDK refuses to
build one. `LauncherAddresses.mevModule` is retained for existing deployment
records but is deprecated and never read when building a launch.

Module addresses are deployment inputs, not source constants:

```ts
import {
  launchPairKey,
  resolveLaunchPairs,
  defaultLaunchPair,
  BASE_MAINNET_CHAIN_ID,
} from '@rwagmi/token-launcher-sdk'

const pairs = resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, {
  [launchPairKey(BASE_MAINNET_CHAIN_ID, WETH)]: process.env.PAIR_MODULE_WETH,
  [launchPairKey(BASE_MAINNET_CHAIN_ID, GOOGLC)]: process.env.PAIR_MODULE_GOOGLC,
})
const pair = defaultLaunchPair(pairs) // canonical WETH
```

A pair with no configured module is dropped, and a configuration with no WETH
pair returns an empty list — every product default here is written for WETH, so
a stock-only configuration is always a misconfiguration.

The pair-bound modules are not deployed yet. Until they are, use
`legacyWethLaunchPair(chainId)`, which reproduces the single WETH pair the
deployed launcher accepts today through its legacy unbound module.

Two optional chain-aware guards:

- `selectLiveLaunchPairs(pairs, state, legacy)` narrows the list to pairs the
  launcher currently accepts, from `mevModuleEnabled` / `pairedTokenEnabled`.
- `evaluatePairPreflight(pair, bytecode)` refuses a paired token with no
  deployed code, whose LP fees could never be claimed.

## Launch Rules Your UI Should Preserve

- The RWAGMI launcher supports only B20 Asset tokens.
- Pairs are curated. Show the pair's `riskLabel`: `canonical-weth` has no
  issuer, while `admin-controlled-b20-stock` is a third-party token whose issuer
  retains live mint, burn, pause, and transfer-policy powers over an already
  created pool.
- The auction module is mandatory, and is bound to the selected pair.
- A creator dev buy is WETH-only, and its minimum output is required.
- Immutable mode creates the B20 with no admin.
- Admin mode leaves live B20 admin powers and should be shown plainly.
- RWAGMI's 10% is a share of launch LP fees, not an extra swap fee.
- Reward bps are immutable after launch; reward admins can only rotate their
  recipient or admin slot.
- The opening price is aligned down to tick spacing. Show the executed price
  from `alignedStartingPrice`, not the requested one.

## Important API

- `prepareRwagmiLaunch(args)` returns the predicted token, typed config,
  reviewable transaction plan, and raw transaction request.
- `buildLaunchConfig(args)` creates the LaunchConfig tuple without touching the
  network. Use it when you already know the predicted token address.
- `prepareLaunchB20(args)` creates a `PreparedB20Write`.
- `predictLaunchTokenAddress(args)` predicts the B20 address with the launcher
  as deployer.
- `resolveLaunchPairs`, `defaultLaunchPair`, `launchPairFrom`,
  `launchPairFactsFor`, and `legacyWethLaunchPair` resolve launch pairs.
- `selectLiveLaunchPairs` and `evaluatePairPreflight` add the chain-aware pair
  guards.
- `alignedStartingPrice(price, decimals, pairedDecimals, spacing)` returns the
  tick that will actually execute and its human price.
- `quoteLaunchDevBuy(...)` and `minimumOutForSlippage(...)` size a creator buy.
- `mineVanityB20Salt(variant, sender)` mines a salt offline whose token address
  ends in a chosen suffix. Always re-check it with `predictB20Address`.
- `parseLaunchReceipt(receipt, launcher?)` extracts `B20TokenCreated`.
- `decodeB20Error(error)` and `decodeRevertData(data)` turn common custom
  errors into readable messages.
- `prepareCollectLaunchRewards`, `prepareClaimLaunchRewards`,
  `prepareUpdateLaunchRewardRecipient`, and `prepareUpdateLaunchRewardAdmin`
  prepare post-launch locker writes.

See [docs/implementation-details.md](docs/implementation-details.md) for the
full architecture notes.

## Development

`viem` is a peer dependency (install it alongside the SDK in your app). It is
also a dev dependency here so the tests and typecheck run locally.

```bash
npm install
npm run typecheck   # tsc, no emit
npm run build       # emit dist/
npm test            # vitest
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
