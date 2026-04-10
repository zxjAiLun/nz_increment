import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SEASONS, type SeasonContent } from '../data/seasons'

export const useSeasonStore = defineStore('season', () => {
  const currentSeason = ref<SeasonContent>(SEASONS[0])
  const seasonPoints = ref(0)
  const seasonLevel = ref(1)
  const ownedSeasonItems = ref<string[]>([])

  function addSeasonPoints(points: number) {
    seasonPoints.value += points
    // 每100点升1级
    seasonLevel.value = Math.floor(seasonPoints.value / 100) + 1
  }

  function claimSeasonReward(level: number): boolean {
    const reward = currentSeason.value.seasonPassReward.find(r => r.level === level)
    if (!reward) return false
    if (seasonLevel.value < level) return false
    if (ownedSeasonItems.value.includes(reward.item)) return false

    ownedSeasonItems.value.push(reward.item)
    return true
  }

  function isExclusiveOwned(itemId: string): boolean {
    return ownedSeasonItems.value.includes(itemId) || currentSeason.value.exclusiveItems.some(i => i.id === itemId)
  }

  function isSeasonActive(): boolean {
    const now = Date.now()
    return now >= currentSeason.value.startDate && now <= currentSeason.value.endDate
  }

  function getRemainingDays(): number {
    const remaining = currentSeason.value.endDate - Date.now()
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
  }

  return { currentSeason, seasonPoints, seasonLevel, ownedSeasonItems, addSeasonPoints, claimSeasonReward, isExclusiveOwned, isSeasonActive, getRemainingDays }
})
