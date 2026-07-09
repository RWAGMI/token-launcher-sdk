import type { Address } from 'viem'
import { rwagmiLpLockerAbi } from './abi/rwagmi-lp-locker.js'
import { prepareWrite, type PreparedB20Write } from './tx-plan.js'

export interface LaunchRewardsCtx {
  chainId: number
  locker: Address
  token: Address
  /** Compact launch token symbol for labels. */
  symbol: string
}

export interface ClaimLaunchRewardsCtx {
  chainId: number
  locker: Address
  currency: Address
  /** Compact reward currency symbol for labels. */
  currencySymbol?: string
}

export function prepareCollectLaunchRewards(ctx: LaunchRewardsCtx): PreparedB20Write {
  return prepareWrite({
    kind: 'collectLaunchRewards',
    label: `Collect accrued launch LP rewards for ${ctx.symbol}`,
    chainId: ctx.chainId,
    to: ctx.locker,
    abi: rwagmiLpLockerAbi,
    functionName: 'collectRewards',
    args: [ctx.token],
    riskLevel: 'medium',
    warnings: [
      'Harvests accrued Uniswap v4 LP fees for the launch pool.',
      'Credited reward balances are assigned to the configured recipients.',
    ],
  })
}

export function prepareClaimLaunchRewards(ctx: ClaimLaunchRewardsCtx): PreparedB20Write {
  const currencyLabel = ctx.currencySymbol ?? ctx.currency
  return prepareWrite({
    kind: 'claimLaunchRewards',
    label: `Claim credited launch LP rewards in ${currencyLabel}`,
    chainId: ctx.chainId,
    to: ctx.locker,
    abi: rwagmiLpLockerAbi,
    functionName: 'claimRewards',
    args: [ctx.currency],
    riskLevel: 'low',
    warnings: ['Claims only the connected wallet’s credited reward balance.'],
  })
}

export function prepareUpdateLaunchRewardRecipient(
  ctx: LaunchRewardsCtx,
  rewardIndex: bigint,
  newRecipient: Address,
): PreparedB20Write {
  return prepareWrite({
    kind: 'updateLaunchRewardRecipient',
    label: `Update ${ctx.symbol} launch reward recipient #${rewardIndex} to ${newRecipient}`,
    chainId: ctx.chainId,
    to: ctx.locker,
    abi: rwagmiLpLockerAbi,
    functionName: 'updateRewardRecipient',
    args: [ctx.token, rewardIndex, newRecipient],
    riskLevel: 'high',
    warnings: [
      'Only the admin for this reward slot can rotate its recipient.',
      'Reward bps are immutable; this changes only where future credited rewards can be claimed.',
    ],
  })
}

export function prepareUpdateLaunchRewardAdmin(
  ctx: LaunchRewardsCtx,
  rewardIndex: bigint,
  newAdmin: Address,
): PreparedB20Write {
  return prepareWrite({
    kind: 'updateLaunchRewardAdmin',
    label: `Update ${ctx.symbol} launch reward admin #${rewardIndex} to ${newAdmin}`,
    chainId: ctx.chainId,
    to: ctx.locker,
    abi: rwagmiLpLockerAbi,
    functionName: 'updateRewardAdmin',
    args: [ctx.token, rewardIndex, newAdmin],
    riskLevel: 'high',
    warnings: [
      'Only the admin for this reward slot can rotate its admin.',
      'Reward bps are immutable; this transfers control for this slot only.',
    ],
  })
}
