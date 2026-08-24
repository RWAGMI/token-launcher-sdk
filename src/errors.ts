import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from 'viem'
import { accessControlAbi } from './abi/access-control.js'
import { b20Abi } from './abi/b20.js'
import { b20AssetAbi } from './abi/b20-asset.js'
import { rwagmiEthDevBuyAbi } from './abi/rwagmi-eth-dev-buy.js'
import { rwagmiHookV2Abi } from './abi/rwagmi-hook-v2.js'
import { rwagmiLauncherAbi } from './abi/rwagmi-launcher.js'
import { rwagmiLpLockerAbi } from './abi/rwagmi-lp-locker.js'
import { rwagmiPairBoundSniperAuctionV1Abi } from './abi/rwagmi-pair-bound-sniper-auction-v1.js'
import { rwagmiSniperAuctionV0Abi } from './abi/rwagmi-sniper-auction-v0.js'
import { roleNameForHash } from './roles.js'

/** Combined error ABI covering every B20 layer we surface. */
const COMBINED_ERROR_ABI: Abi = [
  ...accessControlAbi,
  ...b20Abi,
  ...b20AssetAbi,
  ...rwagmiLauncherAbi,
  ...rwagmiLpLockerAbi,
  ...rwagmiHookV2Abi,
  ...rwagmiSniperAuctionV0Abi,
  ...rwagmiPairBoundSniperAuctionV1Abi,
  ...rwagmiEthDevBuyAbi,
] as unknown as Abi

export interface DecodedB20Error {
  /** Solidity error name, if recognised. */
  name?: string
  /** Human-readable, operator-facing explanation. */
  message: string
  /** Decoded args, when available. */
  args?: readonly unknown[]
}

const WALLET_REJECTION_MESSAGE = 'Transaction cancelled in wallet.'

/**
 * Turn a thrown viem error (or raw revert data) into a readable message.
 * Recognises the access-control and B20 custom errors and explains the
 * common "you don't have the role" case in plain language.
 */
export function decodeB20Error(error: unknown): DecodedB20Error {
  if (isWalletRejection(error)) {
    return { message: WALLET_REJECTION_MESSAGE }
  }

  // Walk viem's error chain for a contract revert with structured data.
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null
    if (revert?.data) {
      return explain(revert.data.errorName, revert.data.args)
    }
    // No structured data — fall back to the short message.
    const message = error.shortMessage || error.message
    return { message: infrastructureErrorMessage(message) ?? message }
  }

  if (error instanceof Error) {
    return { message: infrastructureErrorMessage(error.message) ?? error.message }
  }
  const message = String(error)
  return { message: infrastructureErrorMessage(message) ?? message }
}

/** Decode raw revert bytes (e.g. from a failed eth_call) into a message. */
export function decodeRevertData(data: Hex): DecodedB20Error {
  try {
    const decoded = decodeErrorResult({ abi: COMBINED_ERROR_ABI, data })
    return explain(decoded.errorName, decoded.args)
  } catch {
    return { message: `Unrecognised revert (${data.slice(0, 10)}…)` }
  }
}

function infrastructureErrorMessage(message: string): string | null {
  const lower = message.toLowerCase()
  if (
    lower.includes('over rate limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    /\b429\b/.test(lower)
  ) {
    return 'RPC is rate limited. Wait a moment and try again.'
  }
  if (
    (lower.includes('rpc request failed') || lower.includes('http request failed')) &&
    (lower.includes('request body') || lower.includes('url:'))
  ) {
    return 'RPC request failed. Wait a moment and try again.'
  }
  if (
    lower.includes('request arguments:') ||
    lower.includes('raw call arguments:') ||
    lower.includes('version: viem@')
  ) {
    const summary = message
      .split(/\s+(?=(?:Request Arguments|Raw Call Arguments|Details|Version):)/i)[0]
      ?.trim()
    return summary || 'Transaction could not be completed.'
  }
  return null
}

function isWalletRejection(error: unknown): boolean {
  if (typeof error === 'string') return isWalletRejectionMessage(error)

  const seen = new Set<object>()
  let current: unknown = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const candidate = current as {
      cause?: unknown
      code?: unknown
      message?: unknown
      name?: unknown
      shortMessage?: unknown
    }
    if (
      candidate.code === 4001 ||
      candidate.code === 5000 ||
      candidate.name === 'UserRejectedRequestError'
    ) {
      return true
    }
    if (
      (typeof candidate.shortMessage === 'string' &&
        isWalletRejectionMessage(candidate.shortMessage)) ||
      (typeof candidate.message === 'string' &&
        isWalletRejectionMessage(candidate.message))
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

function isWalletRejectionMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected by user') ||
    lower.includes('denied by user')
  )
}

function explain(
  name: string,
  args: readonly unknown[] | undefined,
): DecodedB20Error {
  switch (name) {
    case 'AccessControlUnauthorizedAccount': {
      const role = args?.[1] as Hex | undefined
      const roleName = role ? roleNameForHash(role) : undefined
      return {
        name,
        args,
        message: roleName
          ? `Connected wallet is missing the required ${roleName}.`
          : 'Connected wallet is missing the required role for this action.',
      }
    }
    case 'LastAdminCannotRenounce':
      return {
        name,
        args,
        message:
          'Cannot renounce the last admin this way. Use renounceLastAdmin() to intentionally make the token admin-less.',
      }
    case 'PolicyForbids':
      return {
        name,
        args,
        message:
          'A transfer policy blocked this action (sender, receiver, or executor is not authorized).',
      }
    case 'InternalCallFailed':
      return { name, args, message: 'An announcement internal call reverted.' }
    case 'NotAuctionBlock':
      return {
        name,
        args,
        message:
          'This pool is in its launch auction. Try again on the next auction block, or wait until the auction window ends.',
      }
    case 'GasSignalNegative':
      return {
        name,
        args,
        message:
          'This launch auction bid did not clear the gas signal. Use a priority fee above base fee, or wait until the auction window ends.',
      }
    case 'PoolLocked':
      return {
        name,
        args,
        message: 'This launch auction is already initialized for the pool.',
      }
    case 'MevModuleNotEnabled':
      return {
        name,
        args,
        message: 'The selected launch auction module is not enabled on this launcher.',
      }
    case 'ExtensionNotEnabled':
      return {
        name,
        args,
        message: 'One of the requested launch extensions is not enabled on this launcher.',
      }
    case 'MsgValueMismatch':
      return {
        name,
        args,
        message: 'The ETH attached to this launch does not match the requested extensions.',
      }
    case 'InvalidExtensionBps':
      return {
        name,
        args,
        message: 'Launch extension allocations must total 100% of pool supply or less.',
      }
    case 'DevBuyRequiresOpenTransfers':
      return {
        name,
        args,
        message: 'Creator dev buy requires transfers to be open at launch.',
      }
    case 'DevBuySlippage':
      return {
        name,
        args,
        message: 'Creator dev buy returned less B20 than the configured minimum.',
      }
    case 'SettlementMismatch':
      return {
        name,
        args,
        message: 'Creator dev buy could not settle the expected WETH amount in the v4 pool.',
      }
    case 'UnexpectedPairedTokenPoolKey':
      return {
        name,
        args,
        message: 'Creator dev buy must use the launch pool; external paired-token pool keys are not supported.',
      }
    case 'RebaseMultiplierNotWad':
      return {
        name,
        args,
        message: 'This launch would leave the token multiplier away from 1.0x.',
      }
    case 'OperatorRoleNotAllowed':
      return {
        name,
        args,
        message: 'This launch tries to grant the B20 operator role, which is not allowed.',
      }
    case 'PolicyBlocksLaunchPath':
      return {
        name,
        args,
        message: 'A B20 transfer, mint, or burn policy would block the launch path.',
      }
    case 'PairedTokenNotInPool':
      return {
        name,
        args,
        message:
          'The selected launch auction module is bound to a different paired token than this pool. Pick the module registered for the selected pair.',
      }
    case 'PairedTokenMismatch':
      return {
        name,
        args,
        message:
          'This pool does not contain the paired token its launch auction module is bound to.',
      }
    case 'UnexpectedMevModuleData':
      return {
        name,
        args,
        message: 'This launch auction module takes no configuration data; send empty module data.',
      }
    case 'InvalidAuctionParams':
      return {
        name,
        args,
        message: 'Launch auction parameters must set a nonzero max rounds and payment rate.',
      }
    case 'NotLockerFeeSource':
      return {
        name,
        args,
        message:
          "This pair's launch auction module is not authorised to credit rewards on the locker, so launches against it are disabled. Contact the RWAGMI team.",
      }
    case 'AuctionParamsNotConfigured':
      return {
        name,
        args,
        message:
          "This pair's launch auction module has not been configured yet, so launches against it are disabled. Contact the RWAGMI team.",
      }
    case 'PairedTokenMustBeWeth':
      return {
        name,
        args,
        message: 'Creator dev buy is only available for the WETH pair.',
      }
    default:
      return { name, args, message: `Reverted with ${name}.` }
  }
}
