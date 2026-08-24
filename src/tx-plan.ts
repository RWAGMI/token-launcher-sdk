import { encodeFunctionData, type Abi, type Address, type Hex } from 'viem'
import type { B20RoleName } from './roles.js'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/**
 * A fully-described, NOT-yet-submitted write. The UI renders this for review
 * (calldata, target, warnings) and only sends it after explicit confirmation.
 * This is the single object every action panel produces.
 */
export interface PreparedB20Write {
  /** Stable id for the action kind, e.g. 'mint', 'grantRole'. */
  kind: string
  /** Human-readable label, e.g. "Mint 100 ACME to 0x12…". */
  label: string
  chainId: number
  /** Token whose product surface owns this action, even when `to` is a router/locker/factory. */
  subjectToken: Address
  to: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  value?: bigint
  riskLevel: RiskLevel
  /** Role the connected wallet needs, if known. */
  requiredRole?: B20RoleName
  /** Operator-facing warnings, ordered most to least important. */
  warnings: string[]
  /** True when the UI must force an explicit confirmation checkbox. */
  requiresExplicitConfirm: boolean
}

export interface PrepareWriteInput {
  kind: string
  label: string
  chainId: number
  subjectToken?: Address
  to: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  value?: bigint
  riskLevel?: RiskLevel
  requiredRole?: B20RoleName
  warnings?: string[]
}

/**
 * Build a PreparedB20Write, defaulting risk to 'medium' and auto-requiring
 * explicit confirmation for any critical action.
 */
export function prepareWrite(input: PrepareWriteInput): PreparedB20Write {
  const riskLevel = input.riskLevel ?? 'medium'
  return {
    kind: input.kind,
    label: input.label,
    chainId: input.chainId,
    subjectToken: input.subjectToken ?? input.to,
    to: input.to,
    abi: input.abi,
    functionName: input.functionName,
    args: input.args,
    value: input.value,
    riskLevel,
    requiredRole: input.requiredRole,
    warnings: input.warnings ?? [],
    requiresExplicitConfirm: riskLevel === 'critical',
  }
}

/** Shape suitable for handing straight to wagmi's writeContract. */
export function toWriteContractArgs(plan: PreparedB20Write) {
  return {
    address: plan.to,
    abi: plan.abi,
    functionName: plan.functionName,
    args: plan.args,
    chainId: plan.chainId,
    ...(plan.value !== undefined ? { value: plan.value } : {}),
  }
}

/** Encode a prepared write into a plain raw transaction request. */
export function toTransactionRequest(plan: PreparedB20Write) {
  const data = encodeFunctionData({
    abi: plan.abi,
    functionName: plan.functionName,
    args: plan.args,
  })
  return {
    to: plan.to,
    data,
    chainId: plan.chainId,
    ...(plan.value !== undefined ? { value: plan.value } : {}),
  }
}
