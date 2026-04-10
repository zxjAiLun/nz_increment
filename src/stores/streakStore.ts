import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePlayerStore } from './playerStore'

const STREAK_KEY = 'nz_streak'

export const useStreakStore = defineStore('streak', () => {
  const currentStreak = ref(0)
  const bestStreak = ref(0)
  const lastChallengeDate = ref<string | null>(null)
  const streakRewardsClaimed = ref<string[]>([])
  const streakMultiplier = ref(1.0)

  const STREAK_REWARDS = [
    { days: 3, diamond: 5, gold: 100 },
    { days: 7, diamond: 15, gold: 300 },
    { days: 14, diamond: 30, gold: 600 },
    { days: 30, diamond: 100, gold: 2000 },
  ]

  function load() {
    const saved = localStorage.getItem(STREAK_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      currentStreak.value = data.currentStreak || 0
      bestStreak.value = data.bestStreak || 0
      lastChallengeDate.value = data.lastChallengeDate || null
      streakRewardsClaimed.value = data.streakRewardsClaimed || []
    }
  }

  function save() {
    localStorage.setItem(STREAK_KEY, JSON.stringify({
      currentStreak: currentStreak.value,
      bestStreak: bestStreak.value,
      lastChallengeDate: lastChallengeDate.value,
      streakRewardsClaimed: streakRewardsClaimed.value
    }))
  }

  function getToday(): string {
    return new Date().toISOString().split('T')[0]
  }

  function checkAndUpdateStreak() {
    const today = getToday()
    if (lastChallengeDate.value === today) return  // 今日已挑战

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

    if (lastChallengeDate.value === yesterday) {
      // 连续
      currentStreak.value++
    } else if (lastChallengeDate.value !== today) {
      // 中断
      currentStreak.value = 1
    }

    lastChallengeDate.value = today

    if (currentStreak.value > bestStreak.value) {
      bestStreak.value = currentStreak.value
    }

    // 更新倍率
    streakMultiplier.value = 1.0 + (currentStreak.value - 1) * 0.05  // 每天+5%
    save()
  }

  function claimStreakReward(days: number): boolean {
    const reward = STREAK_REWARDS.find(r => r.days === days)
    if (!reward) return false
    if (streakRewardsClaimed.value.includes(`streak_${days}`)) return false
    if (currentStreak.value < days) return false

    streakRewardsClaimed.value.push(`streak_${days}`)
    const playerStore = usePlayerStore()
    playerStore.addDiamond(reward.diamond)
    playerStore.addGold(reward.gold)
    save()
    return true
  }

  load()
  return { currentStreak, bestStreak, streakMultiplier, streakRewardsClaimed, STREAK_REWARDS, checkAndUpdateStreak, claimStreakReward }
})
