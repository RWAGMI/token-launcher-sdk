import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from 'viem'

/**
 * Local B20Factory address derivation, recovered empirically and verified
 * against the live Base Sepolia factory and base-anvil (both variants, random
 * senders and salts — see tests/vanity.test.ts fixtures):
 *
 *   token = 0xB20 · 18 zero nibbles · variant nibble
 *               · first 9 bytes of keccak256(abi.encode(sender, salt))
 *
 * Only the trailing 18 nibbles carry entropy, so a short vanity suffix can be
 * mined offline with plain keccak instead of `getB20Address` RPC calls. The
 * formula is protocol-sealed but undocumented; callers MUST keep verifying the
 * final salt with `predictB20Address` (chain truth) before submitting, so any
 * future derivation change degrades to a non-vanity address rather than a
 * wrong deployment.
 */

export type B20VariantName = 'asset' | 'stablecoin'

/** Suffix every RWAGMI-deployed token address is mined to end with. */
export const B20_VANITY_SUFFIX = 'b20'

const ADDRESS_PREFIX = 'b20000000000000000000' // 0xB20 + 18 zero nibbles

/** Pure local equivalent of B20Factory.getB20Address. */
export function computeB20Address(
  variant: B20VariantName,
  sender: Address,
  salt: Hex,
): Address {
  const digest = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }],
      [sender, salt],
    ),
  )
  const variantNibble = variant === 'asset' ? '0' : '1'
  return getAddress(`0x${ADDRESS_PREFIX}${variantNibble}${digest.slice(2, 20)}`)
}

export interface MineVanitySaltOptions {
  /** Lowercase hex suffix to mine for. Defaults to `B20_VANITY_SUFFIX`. */
  suffix?: string
  /**
   * Attempt cap. At 1/16^3 per try the default (2^17) leaves a miss chance of
   * ~e^-32; hitting it in practice means the suffix is longer than intended.
   */
  maxTries?: number
}

export interface MinedVanitySalt {
  salt: Hex
  address: Address
  tries: number
}

/**
 * Mine a salt whose deterministic token address ends with `suffix` for the
 * given `(variant, sender)`. Pure CPU (keccak only, no RPC); a 3-nibble suffix
 * takes ~4096 tries ≈ milliseconds. Throws if `maxTries` is exhausted —
 * callers should fall back to `randomSalt()`.
 */
export function mineVanityB20Salt(
  variant: B20VariantName,
  sender: Address,
  options: MineVanitySaltOptions = {},
): MinedVanitySalt {
  const suffix = options.suffix ?? B20_VANITY_SUFFIX
  const maxTries = options.maxTries ?? 131072
  if (!/^[0-9a-f]{1,18}$/.test(suffix)) {
    throw new Error(
      `Vanity suffix must be 1-18 lowercase hex characters, got "${suffix}"`,
    )
  }

  // Random 32-byte base, then a counter in the low bytes: uniform addresses
  // (keccak mixes) without a getRandomValues call per attempt.
  const base = new Uint8Array(32)
  globalThis.crypto.getRandomValues(base)
  const baseHex = Array.from(base.slice(0, 24), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const start = BigInt(
    `0x${Array.from(base.slice(24), (b) => b.toString(16).padStart(2, '0')).join('')}`,
  )

  for (let tries = 1; tries <= maxTries; tries++) {
    const counter = (start + BigInt(tries)) & ((1n << 64n) - 1n)
    const salt: Hex = `0x${baseHex}${counter.toString(16).padStart(16, '0')}`
    const address = computeB20Address(variant, sender, salt)
    if (address.toLowerCase().endsWith(suffix)) {
      return { salt, address, tries }
    }
  }
  throw new Error(
    `No salt with address suffix "${suffix}" found in ${maxTries} tries`,
  )
}
