import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PvPSeason } from '../types/pvp'

export const useArenaStore = defineStore('arena', () => {
  const currentRating = ref(1000)
  const rank = ref(1)
  const winCount = ref(0)
  const loseCount = ref(0)
  const matching = ref(false)
  
  // T79 竞技场赛季系统
  const currentSeason = ref<PvPSeason>({
    id: 'season_1',
    startTime: Date.now(),
    endTime: Date.now() + 86400000 * 7,
    rewards: [],
  })
  
  // T79 赛季排行榜
  const seasonLeaderboard = ref<{ playerId: string; playerName: string; rating: number; wins: number }[]>([])
  
  // T79 赛季历史
  const seasonHistory = ref<{ seasonId: string; finalRank: number; finalRating: number; rewards: string[] }[]>([])
  
  // T79 当前玩家赛季数据
  const playerSeasonData = ref({
    seasonWins: 0,
    seasonLosses: 0,
    seasonTopRating: 0,
    consecutiveWins: 0,
    maxConsecutiveWins: 0,
  })

  const ratingToRank = (r: number) => Math.floor(r / 100)
  
  // T79 计算赛季排名
  const seasonRank = computed(() => {
    const playerRating = currentRating.value
    const higherCount = seasonLeaderboard.value.filter(p => p.rating > playerRating).length
    return higherCount + 1
  })
  
  // T79 计算赛季奖励
  const pendingSeasonRewards = computed(() => {
    const r = seasonRank.value
    const rewards: string[] = []
    if (r <= 10) rewards.push('arena_legend_title', 'diamond_1000', 'arena_skin_legend')
    else if (r <= 50) rewards.push('arena_master_title', 'diamond_500')
    else if (r <= 100) rewards.push('arena_expert_title', 'diamond_200')
    else if (r <= 500) rewards.push('arena_veteran_title', 'diamond_100')
    else rewards.push('arena_participant_title', 'diamond_50')
    return rewards
  })

  function startMatching() {
    matching.value = true
    setTimeout(() => {
      matching.value = false
      const won = Math.random() > 0.5
      recordResult(won)
    }, 3000)
  }

  function recordResult(won: boolean) {
    if (won) {
      winCount.value++
      playerSeasonData.value.seasonWins++
      playerSeasonData.value.consecutiveWins++
      playerSeasonData.value.maxConsecutiveWins = Math.max(playerSeasonData.value.maxConsecutiveWins, playerSeasonData.value.consecutiveWins)
      currentRating.value += 25
    } else {
      loseCount.value++
      playerSeasonData.value.seasonLosses++
      playerSeasonData.value.consecutiveWins = 0
      currentRating.value = Math.max(0, currentRating.value - 25)
    }
    playerSeasonData.value.seasonTopRating = Math.max(playerSeasonData.value.seasonTopRating, currentRating.value)
    rank.value = ratingToRank(currentRating.value)
  }
  
  // T79 重置赛季
  function resetSeason() {
    // 保存当前赛季到历史
    seasonHistory.value.push({
      seasonId: currentSeason.value.id,
      finalRank: seasonRank.value,
      finalRating: currentRating.value,
      rewards: pendingSeasonRewards.value,
    })
    
    // 开始新赛季
    const seasonNum = parseInt(currentSeason.value.id.split('_')[1] || '1') + 1
    currentSeason.value = {
      id: `season_${seasonNum}`,
      startTime: Date.now(),
      endTime: Date.now() + 86400000 * 7,
      rewards: [],
    }
    
    // 重置玩家数据
    playerSeasonData.value = {
      seasonWins: 0,
      seasonLosses: 0,
      seasonTopRating: 0,
      consecutiveWins: 0,
      maxConsecutiveWins: 0,
    }
    
    // 清空排行榜并降低积分
    currentRating.value = Math.max(1000, currentRating.value - 200)
    seasonLeaderboard.value = []
  }
  
  // T79 领取赛季奖励
  function claimSeasonRewards(): string[] {
    const rewards = pendingSeasonRewards.value
    // 重置连击
    playerSeasonData.value.seasonWins = 0
    playerSeasonData.value.seasonLosses = 0
    return rewards
  }

  return {
    currentRating,
    rank,
    winCount,
    loseCount,
    currentSeason,
    matching,
    seasonLeaderboard,
    seasonHistory,
    playerSeasonData,
    seasonRank,
    pendingSeasonRewards,
    startMatching,
    recordResult,
    resetSeason,
    claimSeasonRewards,
  }
})
