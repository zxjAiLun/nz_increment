import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SEASONS, type LeaderboardEntry, type LeaderboardSeason } from '../data/leaderboard'
import { usePlayerStore } from './playerStore'

function generateShadowLeaderboard(basePower: number, baseFloor: number): LeaderboardEntry[] {
  const shadows: LeaderboardEntry[] = []
  const names = ['影子·苍雷', '影子·暗鸦', '影子·寒锋', '影子·赤焰', '影子·碎星', '影子·夜航', '影子·玄铁', '影子·霜羽']
  for (let i = 0; i < 80; i++) {
    const powerOffset = (80 - i) * 900
    const floorOffset = Math.max(0, 25 - Math.floor(i / 4))
    shadows.push({
      rank: i + 1,
      playerId: `shadow_${i}`,
      playerName: `${names[i % names.length]}#${i + 1}`,
      level: 30 + Math.floor((i % 30) + i / 8),
      totalPower: Math.max(5000, basePower + powerOffset + (i % 5) * 300),
      arenaRank: i + 1,
      floorReached: Math.max(1, baseFloor + floorOffset),
      lastUpdated: Date.now() - i * 60000
    })
  }
  return shadows
}

export const useLeaderboardStore = defineStore('leaderboard', () => {
  const entries = ref<LeaderboardEntry[]>([])
  const currentSeason = ref<LeaderboardSeason>(SEASONS[0])
  const myRank = ref<number | null>(null)
  const loading = ref(false)

  async function fetchLeaderboard() {
    loading.value = true
    await new Promise(r => setTimeout(r, 100))  // mock delay

    const playerStore = usePlayerStore()
    const basePower = Math.floor(
      playerStore.totalStats.attack +
      playerStore.totalStats.defense +
      playerStore.totalStats.maxHp * 0.08 +
      playerStore.totalStats.speed * 25
    )
    const baseFloor = Math.max(1, playerStore.player.level)

    const shadowEntries = generateShadowLeaderboard(basePower, baseFloor)
    const localHistory = playerStore.getLeaderboard().map((item, index) => ({
      rank: index + 1,
      playerId: `local_history_${index}`,
      playerName: item.name,
      level: Math.max(1, Math.floor(item.difficultyValue / 10)),
      totalPower: Math.max(1000, item.difficultyValue * 50 + item.totalKills * 2),
      arenaRank: index + 1,
      floorReached: Math.max(1, Math.floor(item.difficultyValue / 10)),
      lastUpdated: item.updatedAt
    }))

    const me: LeaderboardEntry = {
      rank: 1,
      playerId: 'player_me',
      playerName: playerStore.player.name || '我',
      level: playerStore.player.level,
      totalPower: basePower,
      arenaRank: 1,
      floorReached: baseFloor,
      lastUpdated: Date.now()
    }

    const merged = [me, ...localHistory, ...shadowEntries]
    merged.sort((a, b) => b.totalPower - a.totalPower)
    merged.forEach((item, index) => {
      item.rank = index + 1
    })
    entries.value = merged.slice(0, 100)
    myRank.value = entries.value.find(item => item.playerId === 'player_me')?.rank || 1
    loading.value = false
  }

  function getSeasonReward(rank: number) {
    return currentSeason.value.rewards.find(r => r.rank === rank)?.reward || null
  }

  return { entries, currentSeason, myRank, loading, fetchLeaderboard, getSeasonReward }
})
