# RWAGMI Token Launcher SDK

Standalone TypeScript SDK for integrating the RWAGMI B20 token launcher into an
external product.

This package prepares wallet-reviewable transactions for launching a new Base
B20 Asset token into a RWAGMI Uniswap v4 pool. It does not custody keys, submit
transactions for the user, run an indexer, or depend on the RWAGMI web app.

## What This SDK Does

- Builds the `RwagmiB20Launcher.launchB20(config)` transaction.
- Predicts the B20 token address before launch through the B20Factory
  precompile.
- Encodes immutable or admin-mode Asset token bootstrap calls.
- Builds the one-sided Uniswap v4 launch liquidity ranges.
- Supports the optional ETH dev-buy extension.
- Parses the launch receipt into token, pool, hook, locker, and reward details.
- Prepares post-launch reward collection, claiming, and reward-slot rotation
  transactions.
- Decodes common B20 and RWAGMI custom errors into product-facing messages.

## What This SDK Does Not Do

- It does not store or request private keys.
- It does not create arbitrary ERC20 pairs or act as a swap aggregator.
- It does not launch B20 Stablecoins. Current RWAGMI launcher scope is B20 Asset
  tokens only.
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
  BASE_WETH,
  DEFAULT_LAUNCHER_ADDRESSES,
  DEFAULT_RWAGMI_FEE_CONFIG,
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
  draft: {
    variant: 'asset',
    name: 'Example Token',
    symbol: 'EXAMP',
    decimals: 18,
    salt: randomSalt(),
    poolSupply: parseUnits('1000000', 18),
    creatorRecipient: creator,
    creatorAdmin: creator,
    pairedToken: BASE_WETH,
    pairedDecimals: 18,
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
2. Collect launch form inputs: name, symbol, decimals, metadata URI, supply,
   initial price, reward recipient, reward admin, and admin mode.
3. Convert human amounts to base units with `parseUnits`.
4. Resolve or configure the launcher stack addresses for the active chain.
5. Call `prepareRwagmiLaunch`.
6. Render `prepared.plan` for review, including `to`, `functionName`, `value`,
   risk level, and warnings.
7. Simulate the call if your wallet stack supports simulation.
8. Submit with `writeContract(toWriteContractArgs(prepared.plan))` or
   `sendTransaction(prepared.transactionRequest)`.
9. Parse the mined receipt with `parseLaunchReceipt`.
10. Store the returned token address and pool details in your product.

## Required Configuration

The SDK ships with current public deployment constants:

- `DEFAULT_LAUNCHER_ADDRESSES[8453]` for Base mainnet.
- `DEFAULT_LAUNCHER_ADDRESSES[84532]` for Base Sepolia.
- `DEFAULT_RWAGMI_FEE_CONFIG[chainId]` for RWAGMI's 10% launch LP-fee reward
  slot.
- `BASE_WETH` for the canonical Base WETH pair token.

For production apps, keep these values in your own runtime config so you can
upgrade without rebuilding this SDK.

## Launch Rules Your UI Should Preserve

- The RWAGMI launcher supports only B20 Asset tokens.
- Current deployment scope is WETH paired.
- The MEV auction module is mandatory.
- Immutable mode creates the B20 with no admin.
- Admin mode leaves live B20 admin powers and should be shown plainly.
- RWAGMI's 10% is a share of launch LP fees, not an extra swap fee.
- Reward bps are immutable after launch; reward admins can only rotate their
  recipient or admin slot.

## Important API

- `prepareRwagmiLaunch(args)` returns the predicted token, typed config,
  reviewable transaction plan, and raw transaction request.
- `buildLaunchConfig(args)` creates the LaunchConfig tuple without touching the
  network. Use it when you already know the predicted token address.
- `prepareLaunchB20(args)` creates a `PreparedB20Write`.
- `predictLaunchTokenAddress(args)` predicts the B20 address with the launcher
  as deployer.
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
