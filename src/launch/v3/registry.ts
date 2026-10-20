import { isAddress, zeroAddress, type Address } from 'viem'
import type { LauncherDeploymentV3 } from './types.js'

export interface LauncherDeploymentV2 {
  version: 2
  chainId: number
  launcher: Address
  hook: Address
  locker: Address
  startBlock: bigint
}
export type LauncherDeployment = LauncherDeploymentV2 | LauncherDeploymentV3

/** Historical stacks stay registered for reads/claims after the active launcher changes. */
export function validateLauncherRegistry(
  entries: readonly LauncherDeployment[],
): readonly LauncherDeployment[] {
  const seen = new Set<string>()
  for (const e of entries) {
    const id = `${e.chainId}:${e.launcher.toLowerCase()}`
    if (
      ![8453, 84532].includes(e.chainId) ||
      ![2, 3].includes(e.version) ||
      e.startBlock < 0n ||
      seen.has(id) ||
      [e.launcher, e.hook, e.locker].some(
        (a) => !isAddress(a, { strict: false }) || a.toLowerCase() === zeroAddress,
      )
    )
      throw new Error('Invalid launcher registry')
    seen.add(id)
  }
  return entries
}
export function findLauncherDeployment(
  entries: readonly LauncherDeployment[],
  chainId: number,
  launcher: Address,
) {
  return (
    entries.find(
      (e) => e.chainId === chainId && e.launcher.toLowerCase() === launcher.toLowerCase(),
    ) ?? null
  )
}
