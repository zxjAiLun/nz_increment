import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SEASONS, generateMockLeaderboard, type LeaderboardEntry, type LeaderboardSeason } from '../data/leaderboard'

export const useLeaderboardStore = defineStore('leaderboard', () => {
  const entries = ref<LeaderboardEntry[]>([])
  const currentSeason = ref<LeaderboardSeason>(SEASONS[0])
  const myRank = ref<number | null>(null)
  const loading = ref(false)

  async function fetchLeaderboard() {
    loading.value = true
    await new Promise(r => setTimeout(r, 100))  // mock delay
    entries.value = generateMockLeaderboard()
    // My rank mock
    myRank.value = Math.floor(Math.random() * 200) + 1
    loading.value = false
  }

  function getSeasonReward(rank: number) {
    return currentSeason.value.rewards.find(r => r.rank === rank)?.reward || null
  }

  return { entries, currentSeason, myRank, loading, fetchLeaderboard, getSeasonReward }
})
