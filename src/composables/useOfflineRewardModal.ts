import { usePlayerStore } from '../stores/playerStore'

/**
 * Phase 3.2.1：把离线弹窗的「领取」处理抽成可单测的 composable，
 * 使「领取失败不关闭弹窗」成为可验证的 UI 决策逻辑，而非仅 Store 内部行为。
 *
 * - claim 成功（claimOfflineReward 返回 OfflineSettlement）→ 返回 true，调用方据此关闭弹窗；
 * - claim 失败（返回 null，例如 localStorage 配额 / 写入异常）→ 返回 false，
 *   调用方必须保持弹窗打开，避免用户误以为已领取。
 */
export function useOfflineRewardModal() {
  const playerStore = usePlayerStore()

  function handleClaim(): boolean {
    const claimed = playerStore.claimOfflineReward()
    return claimed !== null
  }

  return { handleClaim }
}
