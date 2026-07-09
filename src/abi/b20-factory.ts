/**
 * Singleton B20Factory precompile (base-std IB20Factory.sol).
 * The create UI submits `createB20`; `getB20Address`, `isB20`, and
 * `isB20Initialized` support deterministic address preview and detection.
 *
 * Variant enum (uint8): 0 = ASSET, 1 = STABLECOIN.
 */
export const b20FactoryAbi = [
  {
    type: 'function',
    name: 'createB20',
    stateMutability: 'payable',
    inputs: [
      { name: 'variant', type: 'uint8' },
      { name: 'salt', type: 'bytes32' },
      { name: 'params', type: 'bytes' },
      { name: 'initCalls', type: 'bytes[]' },
    ],
    outputs: [{ name: 'token', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getB20Address',
    stateMutability: 'view',
    inputs: [
      { name: 'variant', type: 'uint8' },
      { name: 'sender', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'isB20',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isB20Initialized',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const
