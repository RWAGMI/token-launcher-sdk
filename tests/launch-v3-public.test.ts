import { describe, expect, it, vi } from 'vitest'
import { getAddress, type Address, type PublicClient } from 'viem'
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_WETH,
  DEFAULT_LAUNCHER_V3,
  LAUNCH_PAIR_FACTS,
  defaultLauncherV3,
  launchPairKey,
  readLaunchPairsV3,
  resolveLaunchPairs,
  type LauncherDeploymentV3,
} from '../src/index.js'

describe('DEFAULT_LAUNCHER_V3', () => {
  const stack = DEFAULT_LAUNCHER_V3[BASE_MAINNET_CHAIN_ID]!

  it('ships the Base mainnet v3 stack and no Sepolia stack', () => {
    expect(stack.version).toBe(3)
    expect(stack.chainId).toBe(BASE_MAINNET_CHAIN_ID)
    expect(stack.startBlock).toBe(52_861_401n)
    expect(defaultLauncherV3(BASE_MAINNET_CHAIN_ID)).toBe(stack)
    expect(defaultLauncherV3(BASE_SEPOLIA_CHAIN_ID)).toBeNull()
  })

  it('uses checksummed addresses, and a hook address carrying its v4 permission flags', () => {
    for (const address of [stack.launcher, stack.hook, stack.locker, stack.devBuyExtension!]) {
      expect(getAddress(address)).toBe(address)
    }
    // beforeInitialize | beforeSwap | afterSwap | beforeDonate | both swap return deltas.
    expect(BigInt(stack.hook) & 0x3fffn).toBe(0x20ecn)
  })
})

describe('readLaunchPairsV3', () => {
  const deployment: LauncherDeploymentV3 = {
    version: 3,
    chainId: BASE_MAINNET_CHAIN_ID,
    launcher: '0x1111111111111111111111111111111111111111',
    hook: '0x2222222222222222222222222222222222222222',
    locker: '0x3333333333333333333333333333333333333333',
    startBlock: 1n,
  }
  const stock = getAddress('0x4444444444444444444444444444444444444444')
  const disabled = getAddress('0x5555555555555555555555555555555555555555')
  const unreadable = getAddress('0x6666666666666666666666666666666666666666')

  function fakeClient(enabled: Record<string, boolean>) {
    const multicall = vi.fn(
      async ({
        contracts,
      }: {
        contracts: { address: Address; functionName: string; args?: readonly Address[] }[]
      }) =>
        contracts.map((call) => {
          if (call.functionName === 'pairedTokenEnabled')
            return enabled[call.args![0]!.toLowerCase()] ?? false
          if (call.address === unreadable)
            return { status: 'failure', error: new Error('reverted') }
          return {
            status: 'success',
            result:
              call.functionName === 'decimals'
                ? call.address === BASE_WETH
                  ? 18
                  : 8
                : call.address === BASE_WETH
                  ? 'WETH'
                  : 'STOCKc',
          }
        }),
    )
    return {
      client: { getBlockNumber: vi.fn(async () => 100n), multicall } as unknown as PublicClient,
      multicall,
    }
  }

  it('keeps only enabled pairs whose metadata reads, in two unchunked multicalls', async () => {
    const { client, multicall } = fakeClient({
      [BASE_WETH.toLowerCase()]: true,
      [stock.toLowerCase()]: true,
      [unreadable.toLowerCase()]: true,
    })
    const pairs = await readLaunchPairsV3(client, deployment, [
      BASE_WETH,
      stock,
      disabled,
      unreadable,
      stock,
    ])
    expect(pairs).toEqual([
      {
        chainId: BASE_MAINNET_CHAIN_ID,
        token: BASE_WETH,
        decimals: 18,
        symbol: 'WETH',
        supportsEthDevBuy: true,
      },
      {
        chainId: BASE_MAINNET_CHAIN_ID,
        token: stock,
        decimals: 8,
        symbol: 'STOCKc',
        supportsEthDevBuy: false,
      },
    ])
    expect(multicall).toHaveBeenCalledTimes(2)
    for (const [args] of multicall.mock.calls)
      expect(args).toMatchObject({ batchSize: 0, blockNumber: 100n })
  })

  it('defaults its candidates to WETH plus the catalogue for the deployment chain', async () => {
    const { client, multicall } = fakeClient({})
    expect(await readLaunchPairsV3(client, deployment)).toEqual([])
    const checked = multicall.mock.calls[0]![0].contracts.map((call) =>
      call.args![0]!.toLowerCase(),
    )
    const catalogue = LAUNCH_PAIR_FACTS.filter((f) => f.chainId === BASE_MAINNET_CHAIN_ID).map(
      (f) => f.token.toLowerCase(),
    )
    expect(new Set(checked)).toEqual(new Set([BASE_WETH.toLowerCase(), ...catalogue]))
    expect(checked).toHaveLength(new Set(checked).size)
  })
})

describe('v3-only pairs', () => {
  it('are never resolved for a v2 launch, even with a module address', () => {
    const v3Only = LAUNCH_PAIR_FACTS.filter((f) => f.v3Only)
    expect(v3Only.length).toBeGreaterThan(0)
    const modules = Object.fromEntries(
      LAUNCH_PAIR_FACTS.filter((f) => f.chainId === BASE_MAINNET_CHAIN_ID).map((f, i) => [
        launchPairKey(f.chainId, f.token),
        `0x${(0xe000 + i).toString(16).padStart(40, '0')}`,
      ]),
    )
    const resolved = resolveLaunchPairs(BASE_MAINNET_CHAIN_ID, modules).map((p) => p.token)
    for (const fact of v3Only) expect(resolved).not.toContain(fact.token)
  })
})
