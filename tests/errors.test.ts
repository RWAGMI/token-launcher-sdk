import { describe, expect, it } from 'vitest'
import { decodeB20Error } from '../src/index.js'

describe('B20 error decoding', () => {
  it('does not leak raw viem RPC dumps for rate limits', () => {
    const raw = [
      'RPC Request failed.',
      'URL: https://sepolia.base.org',
      'Request body: {"method":"eth_call","params":[{"data":"0xaa9d21cb"}]}',
      'Raw Call Arguments: to: 0x4A6513c898fe1B2d0E78d3b0e0A4a151589B1cBa data: 0xaa9d21cb',
      'Details: over rate limit',
      'Version: viem@2.52.2',
    ].join(' ')

    const decoded = decodeB20Error(new Error(raw))

    expect(decoded.message).toBe('RPC is rate limited. Wait a moment and try again.')
    expect(decoded.message).not.toContain('Request body')
    expect(decoded.message).not.toContain('0xaa9d21cb')
  })

  it('collapses raw RPC transport failures to a short message', () => {
    const decoded = decodeB20Error(
      new Error('RPC Request failed. URL: https://example.invalid Request body: {"method":"eth_call"}'),
    )

    expect(decoded.message).toBe('RPC request failed. Wait a moment and try again.')
  })
})
