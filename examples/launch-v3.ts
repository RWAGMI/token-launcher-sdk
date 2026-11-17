import {
  BASE_MAINNET_CHAIN_ID,
  BASE_WETH,
  STATIC_FEE_V3,
  defaultLauncherV3,
  minimumOutForSlippage,
  mineVanityB20Salt,
  parseLaunchV3Receipt,
  predictB20Address,
  preflightLaunchV3,
  prepareLaunchV3,
  previewLaunchV3,
  quoteLaunchDevBuyV3,
  readLaunchPairsV3,
  toTransactionRequest,
  type LaunchDraftV3,
  type QuoteReferenceV3,
} from '@rwagmi/token-launcher-sdk'
import {
  createPublicClient,
  getAddress,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type TransactionReceipt,
} from 'viem'
import { base } from 'viem/chains'

/**
 * Framework-neutral launcher v3 example: one token across a WETH pool and a
 * tokenized-stock pool, with a 0.01 ETH creator buy.
 *
 * Render `pools` and `plan` for review, then submit `toTransactionRequest(plan)`
 * from the user's wallet after they confirm. USD references come from your own
 * price source: the value of one whole paired token as held onchain.
 */
export async function prepareExampleLaunchV3(creator: Address, wethUsd: string, stockUsd: string) {
  const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })
  const deployment = defaultLauncherV3(BASE_MAINNET_CHAIN_ID)!

  // Enabled catalog candidates, with symbol and decimals read onchain.
  const pairs = await readLaunchPairsV3(client, deployment)
  const hoodToken = getAddress('0xb2000000000000000000006f944897540579d3f2')
  const weth = pairs.find((p) => p.token === BASE_WETH)
  const stock = pairs.find((p) => p.token === hoodToken)
  if (!weth || !stock) throw new Error('WETH and HOODc must be enabled and readable')

  const { salt } = mineVanityB20Salt('asset', deployment.launcher)
  const predictedToken = await predictB20Address(client, deployment.launcher, salt)
  const reference = (usd: string): QuoteReferenceV3 => ({
    usd,
    source: 'your-price-source',
    marketTimestamp: null,
    fetchedAt: new Date().toISOString(),
    basis: 'raw-token',
  })

  const draft: LaunchDraftV3 = {
    name: 'Example Token',
    symbol: 'EXAMP',
    decimals: 18,
    salt,
    liquiditySupply: parseUnits('1000000000', 18),
    adminMode: 'immutable',
    initialAdmin: zeroAddress,
    // Creator slots total 90% (9000 bps) across 1–6 slots; RWAGMI's 10% is appended.
    creatorRewards: [{ admin: creator, recipient: creator, bps: 9000 }],
    openingMarketCapUsd: '6000',
    primaryPair: weth.token,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    pools: [
      { pair: weth, allocationBps: 6000, fee: STATIC_FEE_V3, reference: reference(wethUsd) },
      { pair: stock, allocationBps: 4000, fee: STATIC_FEE_V3, reference: reference(stockUsd) },
    ],
  }

  await preflightLaunchV3(client, deployment, [weth, stock])
  const args = { draft, deployment, predictedToken }

  // The quote simulates the whole launch with eth_call; nothing is created.
  draft.devBuy = { pair: weth.token, amountIn: parseEther('0.01'), minimumOut: 1n, recipient: creator }
  const expected = await quoteLaunchDevBuyV3(client, creator, args)
  draft.devBuy.minimumOut = minimumOutForSlippage(expected, 100)

  const pools = previewLaunchV3(args)
  const plan = prepareLaunchV3(args)
  return { pools, plan, transaction: toTransactionRequest(plan), predictedToken }
}

/** After the transaction is mined: the token, its pools and their positions. */
export function readLaunchedTokenV3(receipt: TransactionReceipt) {
  return parseLaunchV3Receipt(receipt, defaultLauncherV3(BASE_MAINNET_CHAIN_ID)!)
}
