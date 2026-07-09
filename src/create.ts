import {
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
  zeroAddress,
} from 'viem'
import { b20Abi } from './abi/b20.js'
import { b20FactoryAbi } from './abi/b20-factory.js'
import {
  B20_CREATE_PARAMS_VERSION,
  B20_PRECOMPILES,
  B20_VARIANT,
} from './constants.js'
import { prepareWrite, type PreparedB20Write } from './tx-plan.js'

/**
 * Minimal B20Factory helpers needed by the RWAGMI launcher.
 *
 * This standalone package is launch-focused: it exposes Asset create-param
 * encoding and deterministic address prediction because the launcher calls the
 * B20Factory internally. It does not include the full generic B20 creation
 * wizard surface from the RWAGMI operator console.
 */

export interface CreateAssetInput {
  variant: 'asset'
  name: string
  symbol: string
  initialAdmin: Address
  decimals: number
}

export interface CreateOptions {
  chainId: number
  salt: Hex
  /** Initial supply in base units, minted to `mintRecipient` at bootstrap. */
  initialSupply?: bigint
  /** Defaults to initialAdmin. */
  mintRecipient?: Address
  /** ERC-7572 contract URI set atomically at creation. */
  contractURI?: string
}

const ASSET_PARAMS_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'version', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'initialAdmin', type: 'address' },
      { name: 'decimals', type: 'uint8' },
    ],
  },
] as const

export function encodeAssetCreateParams(input: CreateAssetInput): Hex {
  return encodeAbiParameters(ASSET_PARAMS_TUPLE, [
    {
      version: B20_CREATE_PARAMS_VERSION,
      name: input.name,
      symbol: input.symbol,
      initialAdmin: input.initialAdmin,
      decimals: input.decimals,
    },
  ])
}

/**
 * Build the launcher's Asset initCalls subset.
 *
 * Immutable launches usually pass only metadata. Admin-mode launches also mint
 * the pool supply to the launcher so it can seed the v4 position.
 */
export function buildInitCalls(input: CreateAssetInput, options: CreateOptions): Hex[] {
  const calls: Hex[] = []

  if (options.contractURI) {
    calls.push(
      encodeFunctionData({
        abi: b20Abi,
        functionName: 'updateContractURI',
        args: [options.contractURI],
      }),
    )
  }

  if (options.initialSupply !== undefined && options.initialSupply > 0n) {
    const to = options.mintRecipient ?? input.initialAdmin
    if (to === zeroAddress) {
      throw new Error('mint recipient is required when initial admin is zero')
    }
    calls.push(
      encodeFunctionData({
        abi: b20Abi,
        functionName: 'mint',
        args: [to, options.initialSupply],
      }),
    )
  }

  return calls
}

export function prepareCreateB20(
  input: CreateAssetInput,
  options: CreateOptions,
): PreparedB20Write {
  return prepareWrite({
    kind: 'createB20',
    label: `Create asset token ${input.symbol}`,
    chainId: options.chainId,
    to: B20_PRECOMPILES.factory,
    abi: b20FactoryAbi,
    functionName: 'createB20',
    args: [
      B20_VARIANT.ASSET,
      options.salt,
      encodeAssetCreateParams(input),
      buildInitCalls(input, options),
    ],
    riskLevel: 'critical',
    warnings: [
      'This deploys a new B20 Asset token via the B20Factory precompile.',
      'Use prepareLaunchB20 for RWAGMI liquid launches; direct createB20 does not initialize a pool.',
    ],
  })
}

/** Deterministic B20 Asset address for (deployer, salt). */
export async function predictB20Address(
  client: PublicClient,
  deployer: Address,
  salt: Hex,
): Promise<Address> {
  return client.readContract({
    address: B20_PRECOMPILES.factory,
    abi: b20FactoryAbi,
    functionName: 'getB20Address',
    args: [B20_VARIANT.ASSET, deployer, salt],
  })
}

/** Random 32-byte salt for a fresh deterministic B20 address. */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
}
