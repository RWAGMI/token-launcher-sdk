import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, type Address, type Hex } from 'viem'
import {
  B20_CREATE_PARAMS_VERSION,
  B20_PRECOMPILES,
  buildInitCalls,
  encodeAssetCreateParams,
  prepareCreateB20,
  randomSalt,
  type CreateAssetInput,
} from '../src/index.js'
import { b20Abi } from '../src/abi/b20.js'

const ADMIN = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address

const input: CreateAssetInput = {
  variant: 'asset',
  name: 'RWAGMI Token',
  symbol: 'RWG',
  initialAdmin: ADMIN,
  decimals: 18,
}

describe('encodeAssetCreateParams', () => {
  it('is deterministic and round-trips through the params tuple', () => {
    const encoded = encodeAssetCreateParams(input)
    expect(encoded).toBe(encodeAssetCreateParams(input))

    const [decoded] = decodeAbiParameters(
      [
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
      ],
      encoded,
    ) as [{ version: number; name: string; symbol: string; initialAdmin: Address; decimals: number }]

    expect(decoded.version).toBe(B20_CREATE_PARAMS_VERSION)
    expect(decoded.name).toBe('RWAGMI Token')
    expect(decoded.symbol).toBe('RWG')
    expect(decoded.initialAdmin).toBe(ADMIN)
    expect(decoded.decimals).toBe(18)
  })
})

describe('buildInitCalls', () => {
  it('emits an updateContractURI call when a contract URI is supplied', () => {
    const calls = buildInitCalls(input, {
      chainId: 8453,
      salt: randomSalt(),
      contractURI: 'ipfs://metadata',
    })
    expect(calls).toHaveLength(1)
    const decoded = decodeFunctionData({ abi: b20Abi, data: calls[0]! })
    expect(decoded.functionName).toBe('updateContractURI')
    expect((decoded.args as [string])[0]).toBe('ipfs://metadata')
  })

  it('mints the initial supply to the mint recipient', () => {
    const calls = buildInitCalls(input, {
      chainId: 8453,
      salt: randomSalt(),
      initialSupply: 1_000n,
      mintRecipient: ADMIN,
    })
    const decoded = decodeFunctionData({ abi: b20Abi, data: calls.at(-1)! })
    expect(decoded.functionName).toBe('mint')
    expect((decoded.args as [Address, bigint])[0]).toBe(ADMIN)
    expect((decoded.args as [Address, bigint])[1]).toBe(1_000n)
  })

  it('throws when minting supply but the resolved recipient is the zero address', () => {
    expect(() =>
      buildInitCalls(
        { ...input, initialAdmin: ZERO },
        { chainId: 8453, salt: randomSalt(), initialSupply: 1_000n },
      ),
    ).toThrow(/mint recipient/)
  })

  it('emits nothing when no metadata or supply is requested', () => {
    expect(buildInitCalls(input, { chainId: 8453, salt: randomSalt() })).toEqual([])
  })
})

describe('prepareCreateB20', () => {
  it('targets the B20Factory precompile as a critical, explicit-confirm write', () => {
    const plan = prepareCreateB20(input, { chainId: 8453, salt: randomSalt() })
    expect(plan.kind).toBe('createB20')
    expect(plan.to).toBe(B20_PRECOMPILES.factory)
    expect(plan.functionName).toBe('createB20')
    expect(plan.riskLevel).toBe('critical')
    expect(plan.requiresExplicitConfirm).toBe(true)
    expect(plan.warnings.join(' ')).toMatch(/prepareLaunchB20/)
  })
})

describe('randomSalt', () => {
  it('returns a 32-byte hex string and is not repeated', () => {
    const a = randomSalt()
    const b = randomSalt()
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    expect(b).toMatch(/^0x[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})
