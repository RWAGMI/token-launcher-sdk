# Contributing

Thanks for your interest in the RWAGMI Token Launcher SDK.

## Development

```bash
npm install
npm run typecheck   # tsc, no emit
npm run build       # emit dist/
npm test            # vitest
```

`viem` is a peer dependency; it is installed locally as a dev dependency so the
tests and typecheck run.

## Guidelines

- The SDK is deliberately narrow: it prepares wallet-reviewable transactions for
  the RWAGMI B20 launcher and does not custody keys, submit transactions, or run
  an indexer. Please keep new surface aligned with that scope.
- The launch config, tick math, and ABIs mirror the on-chain contracts. Changes
  to that logic must come with tests (see `tests/`).
- Keep the public API (`src/index.ts` exports) tree-shakeable and free of
  Node-only or browser-only assumptions where avoidable.
- Run `npm run typecheck`, `npm run build`, and `npm test` before opening a PR.

## Deployment constants

`src/deployments.ts` ships the current public launcher-stack addresses. If a new
launcher deployment lands, update those constants and note it in `CHANGELOG.md`.
Integrators are also encouraged to pass their own addresses at runtime.
