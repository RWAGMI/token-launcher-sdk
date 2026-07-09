# Changelog

All notable changes to this package are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
