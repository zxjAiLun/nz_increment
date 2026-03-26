import { computed } from 'vue'
import { usePlayerStore } from '../stores/playerStore'

export function useOffline() {
  const playerStore = usePlayerStore()
  
  const hasPendingReward = computed(() => playerStore.pendingOfflineReward !== null)
  
  const pendingRewardText = computed(() => {
    if (!playerStore.pendingOfflineReward) return ''
    const { gold, exp } = playerStore.pendingOfflineReward
    return `离线收益: ${gold} 金币, ${exp} 经验`
  })
  
  function claimReward() {
    playerStore.claimOfflineReward()
  }
  
  return {
    hasPendingReward,
    pendingRewardText,
    claimReward
  }
}
