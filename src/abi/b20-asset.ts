/**
 * Asset variant extensions (base-std IB20Asset.sol):
 * WAD-precision rebase multiplier, scaled-balance helpers, batched mint,
 * onchain announcements, and free-form extra metadata.
 * Multiplier/announcement writes are gated by OPERATOR_ROLE.
 */
export const b20AssetAbi = [
  {
    type: 'function',
    name: 'multiplier',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'scaledBalanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'toScaledBalance',
    stateMutability: 'view',
    inputs: [{ name: 'raw', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'toRawBalance',
    stateMutability: 'view',
    inputs: [{ name: 'scaled', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'updateMultiplier',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newMultiplier', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'batchMint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'announce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'internalCalls', type: 'bytes[]' },
      { name: 'id', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isAnnouncementIdUsed',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'extraMetadata',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'string' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'updateExtraMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'MultiplierUpdated',
    inputs: [{ name: 'newMultiplier', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'Announcement',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'id', type: 'string', indexed: false },
      { name: 'description', type: 'string', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EndAnnouncement',
    inputs: [{ name: 'id', type: 'string', indexed: false }],
  },
  { type: 'error', name: 'InternalCallFailed', inputs: [{ name: 'call', type: 'bytes' }] },
] as const
