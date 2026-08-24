import type { Address } from 'viem'
import { isSupportedChainId } from '../chains.js'

/**
 * Deployed core launcher-stack addresses for one chain.
 *
 * The auction module is deliberately NOT here: from v2.1 each approved pair has
 * its own pair-bound module, and that mapping lives in the curated pair
 * registry (`./pairs.ts`). Keeping a single default module on this object was
 * what allowed a mismatched pair/module launch to be built.
 */
export interface LauncherAddresses {
  launcher: Address
  hook: Address
  locker: Address
  devBuyExtension?: Address
  /**
   * @deprecated Legacy single MEV module (the unbound `RwagmiSniperAuctionV0`).
   * Retained only so existing deployment records and the indexer keep type-
   * checking; the launch builder ignores it and uses the selected pair's module.
   * Do not read this to build a launch.
   */
  mevModule?: Address
}

/** RWAGMI's default reward slot (10% of launch LP fees). */
export interface RwagmiFeeConfig {
  recipient: Address
  admin: Address
}

const isAddress = (v: unknown): v is Address =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && v !== '0x0000000000000000000000000000000000000000'

/**
 * Resolve the launcher stack for `chainId` from a raw (env-sourced) record.
 * Returns null when the chain is unsupported or any address is missing/zero, so
 * the UI can disable launch mode rather than build a broken transaction.
 */
export function resolveLauncherAddresses(
  chainId: number,
  raw: Record<number, Partial<LauncherAddresses> | undefined>,
): LauncherAddresses | null {
  if (!isSupportedChainId(chainId)) return null
  const entry = raw[chainId]
  if (
    !entry ||
    !isAddress(entry.launcher) ||
    !isAddress(entry.hook) ||
    !isAddress(entry.locker)
  ) {
    return null
  }
  return {
    launcher: entry.launcher,
    hook: entry.hook,
    locker: entry.locker,
    devBuyExtension: isAddress(entry.devBuyExtension) ? entry.devBuyExtension : undefined,
    mevModule: isAddress(entry.mevModule) ? entry.mevModule : undefined,
  }
}

/**
 * Validate the RWAGMI fee config. Returns null when either address is
 * missing/zero — launch must be blocked rather than route the 10% to nowhere.
 */
export function resolveRwagmiFeeConfig(
  recipient: string | undefined,
  admin: string | undefined,
): RwagmiFeeConfig | null {
  if (!isAddress(recipient) || !isAddress(admin)) return null
  return { recipient, admin }
}
