/**
 * AccessControl-style role management used by B20 (base-std IB20.sol).
 * Note B20 adds `renounceLastAdmin()` and `setRoleAdmin(...)` on top of the
 * familiar OpenZeppelin surface.
 */
export const accessControlAbi = [
  {
    type: 'function',
    name: 'hasRole',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getRoleAdmin',
    stateMutability: 'view',
    inputs: [{ name: 'role', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'grantRole',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeRole',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'renounceRole',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'renounceLastAdmin',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setRoleAdmin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'adminRole', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'RoleGranted',
    inputs: [
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'RoleRevoked',
    inputs: [
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
    ],
  },
  {
    type: 'error',
    name: 'AccessControlUnauthorizedAccount',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'neededRole', type: 'bytes32' },
    ],
  },
  { type: 'error', name: 'LastAdminCannotRenounce', inputs: [] },
] as const
