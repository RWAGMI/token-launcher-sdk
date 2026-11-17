# Pair catalog

Snapshot: November 17, 2026. Token facts are shipped in
[`src/launch/pairs.ts`](../src/launch/pairs.ts), keyed by chain and token address.
Symbols are display metadata; use the address when selecting a paired asset.

| Base paired assets | Catalog | Shipped v2 modules |
| --- | ---: | ---: |
| Tokenized stocks | 378 | 128 |
| WETH | 1 | 1 |
| OUSD | 1 | 1 |
| RWAGMI | 1 | 1 |
| BAES | 1 | 1 |
| Total | 382 | 132 |

The stock list includes 377 entries from Coinbase's current catalog and the
previously listed COINc. This update adds 193 stocks and the three non-WETH
assets omitted from the previous public SDK. Base Sepolia has a separate WETH
fact and no shipped v2 pair module or v3 deployment.

## Chain verification

At [Base block 58,771,641](https://basescan.org/block/58771641), read-only contract
calls confirmed:

- `pairedTokenEnabled(token)` was true for all 382 Base entries on the
  [v3 launcher](https://basescan.org/address/0xB205c9e7B43ca3a4aA99b82D449354CCB3294B20).
- For each of the 132 v2 defaults, the module's `pairedToken()` matched the
  catalog token, and both `pairedTokenEnabled(token)` and
  `mevModuleEnabled(module)` were true on the
  [v2 launcher](https://basescan.org/address/0x274D92df0d1CEfF9080360191feE0d3299c21B49).
- `feeSourceEnabled(module)` was true on the
  [v2 locker](https://basescan.org/address/0x68275200408371a3B34D36F1Ce058Cba2423F41F)
  for all 132 modules.

The other 250 stocks are `v3Only`. `resolveLaunchPairs` excludes them from v2
even if a caller supplies a module address. For example, HOODc is the 8-decimal
token [`0xb2000000000000000000006F944897540579D3f2`](https://basescan.org/address/0xb2000000000000000000006F944897540579D3f2)
and is available through v3 candidate discovery.

These checks record a specific block. `readLaunchPairsV3` filters candidates
against live state, and `preflightLaunchV3` re-checks a selected launch before
signing. Neither an entry in the catalog nor an allowlist flag guarantees
nonzero supply, liquidity, transfer availability or issuer safety.

## Prices and integration changes

`defaultOpeningPrice` is a static decimal string in paired-token units per
launch token. The values were refreshed from the November 17 price snapshot
to seed a roughly $6,000 opening value for a 100 billion token supply. They are
editable form defaults and can become stale. Supply a current raw-token USD
reference when building a v3 launch using `openingMarketCapUsd`, or explicitly
acknowledge advanced per-pool prices. A quoted stock price and a tokenized
stock's raw-token value can differ.

`usdPriceFeed` is optional, including for v2 stocks with deployed modules.
Without a suitable feed or your own price source, display paired-token units.

`LaunchPairRiskLabel` now has four cases:

| Label | Assets | Integration considerations |
| --- | --- | --- |
| `canonical-weth` | WETH | 18 decimals; the only ETH creator-buy pair |
| `admin-controlled-b20-stock` | Tokenized stocks | 8 decimals; issuer admin and transfer controls |
| `admin-controlled-b20-stablecoin` | OUSD | 6 decimals; issuer controls and peg risk |
| `ecosystem-token` | RWAGMI, BAES | 18 decimals; asset-specific controls and liquidity risk |

Update exhaustive switches over this union. These labels describe asset
categories, not safety ratings. V3 pairs returned by `readLaunchPairsV3` carry
live decimals and symbols; use `launchPairFactsFor(chainId, pair.token)` to
look up optional catalog metadata. Custom candidates can have no catalog entry.

Candidate discovery defaults to this catalog. Pass an explicit address list
to `readLaunchPairsV3` when your deployment accepts additional assets. It does
not enumerate the complete onchain allowlist or fetch a remote stock catalog.
