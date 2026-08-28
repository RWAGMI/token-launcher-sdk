import type { Address, PublicClient } from 'viem'
import {
  prepareLaunchB20,
  type BuildLaunchArgs,
  type LaunchConfigStruct,
  type LaunchDraft,
} from './launch/config.js'
import {
  defaultLaunchPair,
  defaultLaunchPairs,
  type LaunchPairConfig,
} from './launch/pairs.js'
import { isSupportedChainId } from './chains.js'
import { predictB20Address, type CreateAssetInput } from './create.js'
import {
  toTransactionRequest,
  type PreparedB20Write,
} from './tx-plan.js'

export interface PredictLaunchTokenAddressArgs {
  client: PublicClient
  draft: LaunchDraft
  /** The launcher creates the B20 internally, so the launcher is the deployer. */
  launcher: Address
}

export interface PrepareRwagmiLaunchArgs extends Omit<BuildLaunchArgs, 'predictedToken'> {
  client: PublicClient
}

export interface PreparedRwagmiLaunch {
  predictedToken: Address
  config: LaunchConfigStruct
  plan: PreparedB20Write
  transactionRequest: ReturnType<typeof toTransactionRequest>
}

export function launchDraftToCreateAssetInput(draft: LaunchDraft): CreateAssetInput {
  return {
    variant: 'asset',
    name: draft.name,
    symbol: draft.symbol,
    initialAdmin: draft.initialAdmin,
    decimals: draft.decimals,
  }
}

/**
 * The canonical WETH launch pair for `chainId`, bound to the auction module the
 * launcher accepts today.
 *
 * This is the zero-configuration path: the pair that carries every product
 * default in this SDK — the opening price, the preview copy, the ETH dev buy.
 * Returns null when the chain has no live WETH module, which is a real state
 * (Base Sepolia is in it), not an error to paper over: with no module there is
 * no launchable pair, and the honest response is to disable launching rather
 * than build a transaction that reverts.
 *
 * Use `defaultLaunchPairs(chainId)` to offer the stock pairs too, or
 * `resolveLaunchPairs(chainId, modules)` to point at your own deployment.
 */
export function defaultWethLaunchPair(chainId: number): LaunchPairConfig | null {
  if (!isSupportedChainId(chainId)) return null
  return defaultLaunchPair(defaultLaunchPairs(chainId))
}

/**
 * @deprecated Always returns null, and is removed in the next release.
 *
 * It resolved WETH against the pre-v2.1 unbound auction module. That module was
 * removed from the launcher's allowlist by the v2.1 cutover — on Base mainnet
 * and on Base Sepolia — so the pair it used to return now produces a launch
 * that reverts with `MevModuleNotEnabled`. Returning null fails in your code,
 * at zero cost, instead of on-chain after the user has signed.
 *
 * Replace with `defaultWethLaunchPair(chainId)`.
 */
export function legacyWethLaunchPair(_chainId: number): LaunchPairConfig | null {
  return null
}

export async function predictLaunchTokenAddress({
  client,
  draft,
  launcher,
}: PredictLaunchTokenAddressArgs): Promise<Address> {
  return predictB20Address(client, launcher, draft.salt)
}

/**
 * One-call preparation path for product integrations.
 *
 * Returns the deterministic token address, the typed LaunchConfig, the
 * reviewable write plan, and a plain raw transaction request ready for wallet
 * submission.
 *
 * `args.pair` is authoritative: it decides the paired token, its decimals, the
 * auction module, and dev-buy eligibility. The draft's `pairedToken` is
 * cross-checked against it and a mismatch throws rather than silently
 * preferring one.
 */
export async function prepareRwagmiLaunch(
  args: PrepareRwagmiLaunchArgs,
): Promise<PreparedRwagmiLaunch> {
  const predictedToken = await predictLaunchTokenAddress({
    client: args.client,
    draft: args.draft,
    launcher: args.addresses.launcher,
  })
  const plan = prepareLaunchB20({ ...args, predictedToken })
  const config = plan.args[0] as LaunchConfigStruct
  return {
    predictedToken,
    config,
    plan,
    transactionRequest: toTransactionRequest(plan),
  }
}
