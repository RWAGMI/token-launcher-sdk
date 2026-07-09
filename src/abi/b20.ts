/**
 * Core B20 extensions over ERC-20 (base-std IB20.sol):
 * mint/burn (+ memos), per-feature pause, supply cap, metadata mutation,
 * transfer policy references, ERC-2612 permit, and the Memo event.
 *
 * PausableFeature enum (uint8): 0 = TRANSFER, 1 = MINT, 2 = BURN.
 */
export const b20Abi = [
  // --- mint ---
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mintWithMemo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'bytes32' },
    ],
    outputs: [],
  },
  // --- burn ---
  {
    type: 'function',
    name: 'burn',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'burnWithMemo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'burnBlocked',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // --- transfers with memo ---
  {
    type: 'function',
    name: 'transferWithMemo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  // --- pause (per feature) ---
  {
    type: 'function',
    name: 'isPaused',
    stateMutability: 'view',
    inputs: [{ name: 'feature', type: 'uint8' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'pausedFeatures',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8[]' }],
  },
  {
    type: 'function',
    name: 'pause',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'features', type: 'uint8[]' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unpause',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'features', type: 'uint8[]' }],
    outputs: [],
  },
  // --- supply cap ---
  {
    type: 'function',
    name: 'supplyCap',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'updateSupplyCap',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newSupplyCap', type: 'uint256' }],
    outputs: [],
  },
  // --- metadata mutation ---
  {
    type: 'function',
    name: 'contractURI',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'updateName',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newName', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateSymbol',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newSymbol', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateContractURI',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newUri', type: 'string' }],
    outputs: [],
  },
  // --- transfer policy references ---
  {
    type: 'function',
    name: 'policyId',
    stateMutability: 'view',
    inputs: [{ name: 'policyScope', type: 'bytes32' }],
    outputs: [{ type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'updatePolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'policyScope', type: 'bytes32' },
      { name: 'newPolicyId', type: 'uint64' },
    ],
    outputs: [],
  },
  // --- ERC-2612 permit ---
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  // --- events / errors ---
  {
    type: 'event',
    name: 'Memo',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'memo', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'SupplyCapUpdated',
    inputs: [{ name: 'newSupplyCap', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'NameUpdated',
    inputs: [{ name: 'newName', type: 'string', indexed: false }],
  },
  {
    type: 'event',
    name: 'SymbolUpdated',
    inputs: [{ name: 'newSymbol', type: 'string', indexed: false }],
  },
  { type: 'error', name: 'PolicyForbids', inputs: [] },
] as const
