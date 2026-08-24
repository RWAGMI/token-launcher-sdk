import { describe, expect, it, vi } from 'vitest'
import {
  ContractFunctionRevertedError,
  decodeAbiParameters,
  encodeErrorResult,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_LAUNCH_LP_FEE,
  MAX_DEV_BUY_AMOUNT_OUT_MINIMUM,
  minimumOutForSlippage,
  quoteLaunchDevBuy,
  type BuildLaunchArgs,
  type LaunchConfigStruct,
} from '../src/index.js'
import { rwagmiEthDevBuyAbi } from '../src/abi/rwagmi-eth-dev-buy.js'

const LAUNCHER = '0x1111111111111111111111111111111111111111' as const
const HOOK = '0x2222222222222222222222222222222222222222' as const
const LOCKER = '0x3333333333333333333333333333333333333333' as const
const RWAGMI_RECIPIENT = '0x4444444444444444444444444444444444444444' as const
const RWAGMI_ADMIN = '0x5555555555555555555555555555555555555555' as const
const MEV = '0x6666666666666666666666666666666666666666' as const
const DEV_BUY = '0x7777777777777777777777777777777777777777' as const
const CREATOR = '0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const DEV_BUY_ETH = 100_000_000_000_000_000n

function launchArgs(overrides: Partial<BuildLaunchArgs> = {}): BuildLaunchArgs {
  return {
    draft: {
      variant: 'asset',
      name: 'Quoted Token',
      symbol: 'QUOTE',
      decimals: 18,
      salt: (`0x${'11'.repeat(32)}`) as Hex,
      poolSupply: 1_000_000n * 10n ** 18n,
      creatorRecipient: CREATOR,
      creatorAdmin: CREATOR,
      pairedToken: WETH,
      pairedDecimals: 18,
      lpFee: DEFAULT_LAUNCH_LP_FEE,
      initialPrice: 0.0001,
      initialAdmin: CREATOR,
      adminMode: 'immutable',
      devBuyEth: DEV_BUY_ETH,
      devBuyRecipient: CREATOR,
      devBuyAmountOutMinimum: 1n,
    },
    chainId: BASE_SEPOLIA_CHAIN_ID,
    addresses: {
      launcher: LAUNCHER,
      hook: HOOK,
      locker: LOCKER,
      mevModule: MEV,
      devBuyExtension: DEV_BUY,
    },
    rwagmiFee: { recipient: RWAGMI_RECIPIENT, admin: RWAGMI_ADMIN },
    predictedToken: '0x0000000000000000000000000000000000000abc',
    // Pin the curated WETH pair so the quote path does not depend on
    // deployment env vars being present in the test environment.
    pair: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      token: WETH,
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      defaultOpeningPrice: '0.000000000025',
      mevModule: MEV,
      supportsEthDevBuy: true,
      riskLabel: 'canonical-weth' as const,
    },
    ...overrides,
  }
}

function sentinelRevert(actualOut: bigint): ContractFunctionRevertedError {
  return new ContractFunctionRevertedError({
    abi: rwagmiEthDevBuyAbi,
    functionName: 'launchB20',
    data: encodeErrorResult({
      abi: rwagmiEthDevBuyAbi,
      errorName: 'DevBuySlippage',
      args: [MAX_DEV_BUY_AMOUNT_OUT_MINIMUM, actualOut],
    }),
  })
}

describe('minimumOutForSlippage', () => {
  it('applies basis-point slippage with integer rounding down', () => {
    expect(minimumOutForSlippage(1_000_000n, 0)).toBe(1_000_000n)
    expect(minimumOutForSlippage(1_000_001n, 100)).toBe(990_000n)
    expect(minimumOutForSlippage(1_000_000n, 250)).toBe(975_000n)
  })

  it('rejects invalid output and slippage, while keeping the floor positive', () => {
    expect(() => minimumOutForSlippage(0n, 100)).toThrow(/greater than zero/)
    expect(() => minimumOutForSlippage(1_000n, -1)).toThrow(/0 to 9999/)
    expect(() => minimumOutForSlippage(1_000n, 10_000)).toThrow(/0 to 9999/)
    expect(() => minimumOutForSlippage(1_000n, 1.5)).toThrow(/integer/)
    expect(minimumOutForSlippage(1n, 1)).toBe(1n)
    expect(() =>
      minimumOutForSlippage(MAX_DEV_BUY_AMOUNT_OUT_MINIMUM + 1n, 0),
    ).toThrow(/exceeds uint128/)
  })
})

describe('quoteLaunchDevBuy', () => {
  it('decodes exact output from the intentional uint128.max slippage revert', async () => {
    const actualOut = 987_654_321_000_000_000_000n
    const simulateContract = vi.fn(async (request: {
      args: readonly unknown[]
      value?: bigint
    }) => {
      const config = request.args[0] as LaunchConfigStruct
      expect(request.value).toBe(DEV_BUY_ETH)
      expect(config.extensionConfigs).toHaveLength(1)

      const [devBuyConfig] = decodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'amountOutMinimum', type: 'uint128' },
              { name: 'pairedTokenPoolKey', type: 'bytes' },
            ],
          },
        ],
        config.extensionConfigs[0]!.extensionData,
      )
      expect(devBuyConfig.amountOutMinimum).toBe(MAX_DEV_BUY_AMOUNT_OUT_MINIMUM)
      throw sentinelRevert(actualOut)
    })
    const client = { simulateContract } as unknown as PublicClient

    await expect(quoteLaunchDevBuy({ client, account: CREATOR, args: launchArgs() })).resolves.toBe(
      actualOut,
    )
    expect(simulateContract).toHaveBeenCalledOnce()
  })

  it('decodes the sentinel across foreign bundle and realm boundaries', async () => {
    const actualOut = 9_048_651_449_988n
    const foreignExecutionError = {
      cause: {
        data: {
          errorName: 'DevBuySlippage',
          args: [MAX_DEV_BUY_AMOUNT_OUT_MINIMUM, actualOut],
        },
      },
    }
    const client = {
      simulateContract: vi.fn(async () => {
        throw foreignExecutionError
      }),
    } as unknown as PublicClient

    await expect(quoteLaunchDevBuy({ client, account: CREATOR, args: launchArgs() })).resolves.toBe(
      actualOut,
    )
  })

  it('fails closed for malformed, wrong-sentinel, and cyclic foreign errors', async () => {
    const wrongSentinel = {
      cause: {
        data: {
          errorName: 'DevBuySlippage',
          args: [MAX_DEV_BUY_AMOUNT_OUT_MINIMUM - 1n, 10n],
        },
      },
    }
    await expect(
      quoteLaunchDevBuy({
        client: {
          simulateContract: vi.fn(async () => {
            throw wrongSentinel
          }),
        } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs(),
      }),
    ).rejects.toBe(wrongSentinel)

    const cyclicError: { cause?: unknown } = {}
    cyclicError.cause = cyclicError
    await expect(
      quoteLaunchDevBuy({
        client: {
          simulateContract: vi.fn(async () => {
            throw cyclicError
          }),
        } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs(),
      }),
    ).rejects.toBe(cyclicError)
  })

  it('rejects absent ETH, zero output, unrelated errors, and unexpected success', async () => {
    const neverCalled = vi.fn()
    await expect(
      quoteLaunchDevBuy({
        client: { simulateContract: neverCalled } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs({
          draft: { ...launchArgs().draft, devBuyEth: 0n, devBuyAmountOutMinimum: undefined },
        }),
      }),
    ).rejects.toThrow(/ETH must be greater than zero/)
    expect(neverCalled).not.toHaveBeenCalled()

    await expect(
      quoteLaunchDevBuy({
        client: {
          simulateContract: vi.fn(async () => {
            throw sentinelRevert(0n)
          }),
        } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs(),
      }),
    ).rejects.toThrow(/returned zero tokens/)

    const unrelated = new Error('RPC unavailable')
    await expect(
      quoteLaunchDevBuy({
        client: {
          simulateContract: vi.fn(async () => {
            throw unrelated
          }),
        } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs(),
      }),
    ).rejects.toBe(unrelated)

    await expect(
      quoteLaunchDevBuy({
        client: { simulateContract: vi.fn(async () => ({})) } as unknown as PublicClient,
        account: CREATOR,
        args: launchArgs(),
      }),
    ).rejects.toThrow(/unexpectedly succeeded/)
  })
})
