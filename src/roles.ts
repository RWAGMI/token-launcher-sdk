import { keccak256, stringToBytes, type Hex } from 'viem'

/**
 * B20 role names. Preimages match base-std B20Constants.sol exactly:
 * DEFAULT_ADMIN_ROLE is bytes32(0); all others are keccak256 of the name.
 */
export const B20_ROLE_NAMES = [
  'DEFAULT_ADMIN_ROLE',
  'MINT_ROLE',
  'BURN_ROLE',
  'BURN_BLOCKED_ROLE',
  'PAUSE_ROLE',
  'UNPAUSE_ROLE',
  'METADATA_ROLE',
  'OPERATOR_ROLE',
] as const

export type B20RoleName = (typeof B20_ROLE_NAMES)[number]

export const ZERO_ROLE_HASH: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Compute the bytes32 role hash for a role name.
 * DEFAULT_ADMIN_ROLE is the zero hash; everything else is keccak256(name).
 * (Tested against the documented base-std constants.)
 */
export function roleHash(role: B20RoleName): Hex {
  if (role === 'DEFAULT_ADMIN_ROLE') return ZERO_ROLE_HASH
  return keccak256(stringToBytes(role))
}

/** Precomputed map of every known role to its hash. */
export const B20_ROLE_HASHES: Record<B20RoleName, Hex> = Object.fromEntries(
  B20_ROLE_NAMES.map((name) => [name, roleHash(name)]),
) as Record<B20RoleName, Hex>

/** Reverse lookup: hash -> known role name, if recognised. */
export function roleNameForHash(hash: Hex): B20RoleName | undefined {
  const target = hash.toLowerCase()
  return B20_ROLE_NAMES.find(
    (name) => B20_ROLE_HASHES[name].toLowerCase() === target,
  )
}

/** Human-readable description of what each role authorizes. */
export const B20_ROLE_DESCRIPTIONS: Record<B20RoleName, string> = {
  DEFAULT_ADMIN_ROLE:
    'Full admin: grant/revoke roles, update policies and supply cap.',
  MINT_ROLE: 'Create new supply via mint / mintWithMemo.',
  BURN_ROLE: 'Burn caller-held tokens via burn / burnWithMemo.',
  BURN_BLOCKED_ROLE: 'Burn tokens from a blocked account via burnBlocked.',
  PAUSE_ROLE: 'Pause TRANSFER / MINT / BURN features.',
  UNPAUSE_ROLE: 'Unpause TRANSFER / MINT / BURN features.',
  METADATA_ROLE: 'Update name, symbol, contract URI, and extra metadata.',
  OPERATOR_ROLE: 'Asset variant: update rebase multiplier and post announcements.',
}
