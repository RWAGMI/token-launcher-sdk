import type { Address, PublicClient } from 'viem'
import {
  prepareLaunchB20,
  type BuildLaunchArgs,
  type LaunchConfigStruct,
  type LaunchDraft,
} from './launch/config.js'
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
