import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Blessing, Curse, Relic, RoguelikeRun } from '../types/roguelike'
import { BLESSINGS } from '../data/roguelike'

export const useRoguelikeStore = defineStore('roguelike', () => {
  const currentRun = ref<RoguelikeRun>({
    currentFloor: 1,
    maxFloor: 100,
    blessings: [],
    curses: [],
    relics: [],
    score: 0,
    status: 'active'
  })

  function startRun() {
    currentRun.value = {
      currentFloor: 1,
      maxFloor: 100,
      blessings: [],
      curses: [],
      relics: [],
      score: 0,
      status: 'active'
    }
  }

  function selectBlessing(blessing: Blessing) {
    currentRun.value.blessings.push(blessing)
    currentRun.value.score += getRarityScore(blessing.rarity)
  }

  function selectCurse(curse: Curse) {
    currentRun.value.curses.push(curse)
    currentRun.value.score -= 50
  }

  function selectRelic(relic: Relic) {
    currentRun.value.relics.push(relic)
    currentRun.value.score += getRarityScore(relic.rarity) * 2
  }

  function advanceFloor() {
    currentRun.value.currentFloor++
    currentRun.value.score += currentRun.value.currentFloor * 10
  }

  function getRarityScore(rarity: string): number {
    const scores: Record<string, number> = { common: 10, rare: 25, epic: 50, legend: 100 }
    return scores[rarity] || 10
  }

  function getRandomBlessings(count: number): Blessing[] {
    return [...BLESSINGS].sort(() => Math.random() - 0.5).slice(0, count)
  }

  return { currentRun, startRun, selectBlessing, selectCurse, selectRelic, advanceFloor, getRandomBlessings }
})
