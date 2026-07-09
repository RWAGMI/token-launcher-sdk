import { describe, expect, it } from 'vitest'
import {
  B20_ROLE_HASHES,
  B20_ROLE_NAMES,
  ZERO_ROLE_HASH,
  roleHash,
  roleNameForHash,
} from '../src/roles.js'

/**
 * Pinned expected hashes. DEFAULT_ADMIN_ROLE is bytes32(0); the rest are
 * keccak256 of the literal role name, per base-std B20Constants.sol. If base
 * changes a preimage, this test must fail loudly.
 */
const EXPECTED: Record<string, `0x${string}`> = {
  DEFAULT_ADMIN_ROLE: ZERO_ROLE_HASH,
  MINT_ROLE: '0x154c00819833dac601ee5ddded6fda79d9d8b506b911b3dbd54cdb95fe6c3686',
  BURN_ROLE: '0xe97b137254058bd94f28d2f3eb79e2d34074ffb488d042e3bc958e0a57d2fa22',
  BURN_BLOCKED_ROLE:
    '0x7408fdc0d31c7bcb349eab611f5d1168acd4303574993f8cdc98b1cd18c41cae',
  PAUSE_ROLE: '0x139c2898040ef16910dc9f44dc697df79363da767d8bc92f2e310312b816e46d',
  UNPAUSE_ROLE:
    '0x265b220c5a8891efdd9e1b1b7fa72f257bd5169f8d87e319cf3dad6ff52b94ae',
  METADATA_ROLE:
    '0x6bd6b5318a46e5fff572d5e4258a20774aab40cc35ac7680654b9081fcc82f80',
  OPERATOR_ROLE:
    '0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929',
}

describe('role hashes', () => {
  it('DEFAULT_ADMIN_ROLE is the zero hash', () => {
    expect(roleHash('DEFAULT_ADMIN_ROLE')).toBe(ZERO_ROLE_HASH)
  })

  it('matches the pinned base-std constants for every role', () => {
    for (const name of B20_ROLE_NAMES) {
      expect(roleHash(name)).toBe(EXPECTED[name])
      expect(B20_ROLE_HASHES[name]).toBe(EXPECTED[name])
    }
  })

  it('all hashes are 32-byte hex and distinct', () => {
    const values = B20_ROLE_NAMES.map((n) => B20_ROLE_HASHES[n])
    for (const v of values) expect(v).toMatch(/^0x[0-9a-f]{64}$/)
    expect(new Set(values).size).toBe(values.length)
  })

  it('round-trips hash -> name', () => {
    for (const name of B20_ROLE_NAMES) {
      expect(roleNameForHash(B20_ROLE_HASHES[name])).toBe(name)
    }
    expect(roleNameForHash('0xdead' as `0x${string}`)).toBeUndefined()
  })
})
