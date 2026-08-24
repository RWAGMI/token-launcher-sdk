import { describe, expect, it } from 'vitest'
import type { Address, Hex } from 'viem'
import {
  B20_VANITY_SUFFIX,
  computeB20Address,
  mineVanityB20Salt,
} from '../src/vanity.js'

/**
 * Fixtures recorded from the live Base Sepolia B20Factory
 * (`getB20Address` on 0xB20f...0000, 2026-07-17). base-anvil returns the same
 * addresses, confirming the derivation is pure and chain-independent. If these
 * ever fail, the protocol derivation changed — the on-chain predictB20Address
 * verification in the apps keeps deployments correct, but vanity mining must
 * be re-derived.
 */
const DEAD = '0x000000000000000000000000000000000000dEaD' as Address
const saltN = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}` as Hex

const ASSET_VECTORS: Array<[Address, Hex, Address]> = [
  [DEAD, saltN(1), '0xb200000000000000000000b34209a263f6C38Fe5'],
  [DEAD, saltN(2), '0xB2000000000000000000006A9609BAa168169acA'],
  [DEAD, saltN(3), '0xb200000000000000000000262Bb27bBDD95C1Cdc'],
  [DEAD, saltN(4), '0xB20000000000000000000042c63635470f1FB1D6'],
  [
    '0xb0576Fb5666a92661F6Ff12f6D9589347E6cf094',
    '0x02a63ba30252f7406898f4142ff15c9db03c269e738a0dc1d203453c04c237da',
    '0xb200000000000000000000F2B4E7c944242Aedd3',
  ],
  [
    '0x0A7f9d785b02D66e6bF5342876b843AaFd320d46',
    '0xf02fc5eb031fab004ce2d6eaa8dd4df1d2aa59b04368df2179ccf68c16b0765f',
    '0xb2000000000000000000000aa873Fc68c1bFB2AF',
  ],
  [
    '0xAcE02E091f720C656D9B0e4802F17Efa75160784',
    '0x3eb353d103811a5a5e4c2af48de31b539df5a7dc3ba080f4106ec1d0781144a0',
    '0xB20000000000000000000036DEAf9c75Ef08B834',
  ],
]

const STABLECOIN_VECTORS: Array<[Address, Hex, Address]> = [
  [
    '0xb0576Fb5666a92661F6Ff12f6D9589347E6cf094',
    '0x02a63ba30252f7406898f4142ff15c9db03c269e738a0dc1d203453c04c237da',
    '0xb200000000000000000001F2b4E7c944242AedD3',
  ],
  [
    '0x0A7f9d785b02D66e6bF5342876b843AaFd320d46',
    '0xf02fc5eb031fab004ce2d6eaa8dd4df1d2aa59b04368df2179ccf68c16b0765f',
    '0xB2000000000000000000010aA873FC68C1bfb2af',
  ],
  [
    '0xAcE02E091f720C656D9B0e4802F17Efa75160784',
    '0x3eb353d103811a5a5e4c2af48de31b539df5a7dc3ba080f4106ec1d0781144a0',
    '0xB20000000000000000000136DeAF9C75ef08B834',
  ],
  [
    '0xbC9286435a46d8208b1f414cBd8Ee84FBFeccDA9',
    '0x19968adc80b84208226dc5bd0e725960937398f9460c9b3fe78f5e4f00c3f131',
    '0xB2000000000000000000013dfa09bD62991B47f5',
  ],
  [
    '0x3CB1E4FFedE7502E424f62b312339E24E8A050d1',
    '0x9eb956791bda121b83e3d74468996877bb1352a15de225beb588bba54760a756',
    '0xb2000000000000000000011E7798d976010108Cf',
  ],
]

describe('computeB20Address', () => {
  it('reproduces live asset-variant factory addresses exactly', () => {
    for (const [sender, salt, expected] of ASSET_VECTORS) {
      expect(computeB20Address('asset', sender, salt)).toBe(expected)
    }
  })

  it('reproduces live stablecoin-variant factory addresses exactly', () => {
    for (const [sender, salt, expected] of STABLECOIN_VECTORS) {
      expect(computeB20Address('stablecoin', sender, salt)).toBe(expected)
    }
  })

  it('emits the B20 structural prefix for arbitrary inputs', () => {
    const address = computeB20Address('asset', DEAD, saltN(123456789))
    expect(address).toHaveLength(42)
    expect(address.toLowerCase().startsWith('0xb200000000000000000000')).toBe(
      true,
    )
    const stable = computeB20Address('stablecoin', DEAD, saltN(123456789))
    expect(stable.toLowerCase().startsWith('0xb200000000000000000001')).toBe(
      true,
    )
    // variant only flips its nibble; entropy section is identical
    expect(stable.slice(24).toLowerCase()).toBe(address.slice(24).toLowerCase())
  })
})

describe('mineVanityB20Salt', () => {
  it('finds a salt whose address ends with the b20 suffix', () => {
    const mined = mineVanityB20Salt('asset', DEAD)
    expect(mined.address.toLowerCase().endsWith(B20_VANITY_SUFFIX)).toBe(true)
    expect(computeB20Address('asset', DEAD, mined.salt)).toBe(mined.address)
    expect(mined.tries).toBeGreaterThan(0)
  })

  it('honors a custom suffix and sender binding', () => {
    const sender = '0xb0576Fb5666a92661F6Ff12f6D9589347E6cf094' as Address
    const mined = mineVanityB20Salt('stablecoin', sender, { suffix: 'a' })
    expect(mined.address.toLowerCase().endsWith('a')).toBe(true)
    expect(computeB20Address('stablecoin', sender, mined.salt)).toBe(
      mined.address,
    )
  })

  it('produces distinct salts across invocations', () => {
    const a = mineVanityB20Salt('asset', DEAD)
    const b = mineVanityB20Salt('asset', DEAD)
    expect(a.salt).not.toBe(b.salt)
  })

  it('rejects invalid suffixes', () => {
    expect(() => mineVanityB20Salt('asset', DEAD, { suffix: 'B20' })).toThrow()
    expect(() => mineVanityB20Salt('asset', DEAD, { suffix: 'xyz' })).toThrow()
    expect(() => mineVanityB20Salt('asset', DEAD, { suffix: '' })).toThrow()
  })

  it('throws when maxTries is exhausted', () => {
    expect(() =>
      mineVanityB20Salt('asset', DEAD, { suffix: 'ffffffff', maxTries: 8 }),
    ).toThrow(/8 tries/)
  })
})
