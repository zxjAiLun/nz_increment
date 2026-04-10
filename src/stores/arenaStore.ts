import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PvPSeason } from '../types/pvp'

export const useArenaStore = defineStore('arena', () => {
  const currentRating = ref(1000)
  const rank = ref(1)
  const winCount = ref(0)
  const loseCount = ref(0)
  const currentSeason = ref<PvPSeason>({
    id: 'season_1',
    startTime: Date.now(),
    endTime: Date.now() + 86400000 * 7,
    rewards: [],
  })
  const matching = ref(false)

  const ratingToRank = (r: number) => Math.floor(r / 100)

  function startMatching() {
    matching.value = true
    // Mock: 随机匹配到假对手，3秒后返回结果
    setTimeout(() => {
      matching.value = false
      const won = Math.random() > 0.5
      recordResult(won)
    }, 3000)
  }

  function recordResult(won: boolean) {
    if (won) {
      winCount.value++
      currentRating.value += 25
    } else {
      loseCount.value++
      currentRating.value = Math.max(0, currentRating.value - 25)
    }
    rank.value = ratingToRank(currentRating.value)
  }

  return {
    currentRating,
    rank,
    winCount,
    loseCount,
    currentSeason,
    matching,
    startMatching,
    recordResult,
  }
})
