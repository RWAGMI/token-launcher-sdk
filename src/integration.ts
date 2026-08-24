import type { Address, PublicClient } from 'viem'
import {
  prepareLaunchB20,
  type BuildLaunchArgs,
  type LaunchConfigStruct,
  type LaunchDraft,
} from './launch/config.js'
import {
  defaultLaunchPair,
  launchPairKey,
  resolveLaunchPairs,
  type LaunchPairConfig,
} from './launch/pairs.js'
import { BASE_WETH, DEFAULT_LAUNCHER_ADDRESSES } from './deployments.js'
import { isSupportedChainId, type SupportedChainId } from './chains.js'
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
 * The canonical WETH launch pair for `chainId`, bound to the legacy unbound
 * auction module recorded in `DEFAULT_LAUNCHER_ADDRESSES`.
 *
 * Every launch now needs a `LaunchPairConfig`, and from v2.1 the authoritative
 * source is `resolveLaunchPairs` with the deployed pair-bound module addresses.
 * Those modules are not deployed yet, so this is what an integrator uses today:
 * it reproduces the exact pair the launcher currently accepts, and nothing more.
 *
 * Deliberately WETH-only. The legacy module is unbound and would accept any
 * paired token, which is precisely the cross-product hole the pair-bound
 * modules close — so it must never be handed to a stock pair.
 *
 * Returns null when the chain has no recorded legacy module. Once the v2.1
 * modules are live, switch to `resolveLaunchPairs` and drop this.
 */
export function legacyWethLaunchPair(chainId: number): LaunchPairConfig | null {
  if (!isSupportedChainId(chainId)) return null
  const legacyModule = DEFAULT_LAUNCHER_ADDRESSES[chainId as SupportedChainId]?.mevModule
  if (!legacyModule) return null
  return defaultLaunchPair(
    resolveLaunchPairs(chainId, {
      [launchPairKey(chainId, BASE_WETH)]: legacyModule,
    }),
  )
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
