import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeFunctionData, type Address } from 'viem'
import { prepareWrite, toTransactionRequest, toWriteContractArgs } from '../src/index.js'
import { b20Abi } from '../src/abi/b20.js'

const TOKEN = '0x52908400098527886E0F7030069857D2E4169EE7' as Address
const RECIPIENT = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as Address

function mintPlan(overrides: Partial<Parameters<typeof prepareWrite>[0]> = {}) {
  return prepareWrite({
    kind: 'mint',
    label: 'Mint',
    chainId: 8453,
    to: TOKEN,
    abi: b20Abi,
    functionName: 'mint',
    args: [RECIPIENT, 100n],
    ...overrides,
  })
}

describe('prepareWrite', () => {
  it('defaults risk to medium and does not force explicit confirm', () => {
    const plan = mintPlan()
    expect(plan.riskLevel).toBe('medium')
    expect(plan.requiresExplicitConfirm).toBe(false)
    expect(plan.warnings).toEqual([])
  })

  it('auto-requires explicit confirm for critical writes', () => {
    const plan = mintPlan({ riskLevel: 'critical' })
    expect(plan.requiresExplicitConfirm).toBe(true)
  })
})

describe('toWriteContractArgs', () => {
  it('maps the plan onto wagmi writeContract args and only includes value when set', () => {
    expect(toWriteContractArgs(mintPlan())).toEqual({
      address: TOKEN,
      abi: b20Abi,
      functionName: 'mint',
      args: [RECIPIENT, 100n],
      chainId: 8453,
    })
    expect(toWriteContractArgs(mintPlan({ value: 5n })).value).toBe(5n)
  })
})

describe('toTransactionRequest', () => {
  it('encodes plain function calldata with no trailing attribution bytes', () => {
    const req = toTransactionRequest(mintPlan())
    const expected = encodeFunctionData({
      abi: b20Abi,
      functionName: 'mint',
      args: [RECIPIENT, 100n],
    })
    // Exact equality proves no builder-code / suffix is appended to calldata.
    expect(req.data).toBe(expected)
    expect(req.to).toBe(TOKEN)
    expect(req.chainId).toBe(8453)

    const decoded = decodeFunctionData({ abi: b20Abi, data: req.data })
    expect(decoded.functionName).toBe('mint')
    expect(decoded.args).toEqual([RECIPIENT, 100n])
  })

  it('carries value through only when present', () => {
    expect(toTransactionRequest(mintPlan()).value).toBeUndefined()
    expect(toTransactionRequest(mintPlan({ value: 7n })).value).toBe(7n)
  })
})
