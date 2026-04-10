import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SET_BREAKTHROUGH } from '../data/equipmentSets'

export const useSetBreakthroughStore = defineStore('setBreakthrough', () => {
  // 追踪各套装的突破等级 (setId -> breakthroughLevel)
  const breakthroughLevels = ref<{ [setId: string]: number }>({})

  function getBreakthroughLevel(setId: string): number {
    return breakthroughLevels.value[setId] || 0
  }

  function canBreakthrough(setId: string, playerGold: number): boolean {
    const level = getBreakthroughLevel(setId)
    if (level >= 3) return false
    const next = SET_BREAKTHROUGH[setId]?.[level]
    if (!next) return false
    return playerGold >= next.cost
  }

  function breakthrough(setId: string, playerGold: number): boolean {
    if (!canBreakthrough(setId, playerGold)) return false
    const level = getBreakthroughLevel(setId)
    const next = SET_BREAKTHROUGH[setId][level]
    breakthroughLevels.value[setId] = level + 1
    return true
  }

  function getStatMultiplier(setId: string): number {
    const level = getBreakthroughLevel(setId)
    if (level === 0) return 1.0
    return SET_BREAKTHROUGH[setId]?.[level - 1]?.statMultiplier || 1.0
  }

  return { breakthroughLevels, getBreakthroughLevel, canBreakthrough, breakthrough, getStatMultiplier }
})
