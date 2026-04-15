import { defineStore } from 'pinia'
import { ref } from 'vue'
import { BATTLE_SPEEDS } from '../data/battleSpeed'

export const useBattleSpeedStore = defineStore('battleSpeed', () => {
  const speedMultiplier = ref(1)
  const autoMode = ref(false)
  const skipTickets = ref(3)  // 初始3张跳过券

  function setSpeed(multiplier: number) {
    const config = BATTLE_SPEEDS.find(s => s.multiplier === multiplier)
    if (config) speedMultiplier.value = multiplier
  }

  function toggleAuto() {
    autoMode.value = !autoMode.value
  }

  function useSkipTicket(): boolean {
    if (skipTickets.value <= 0) return false
    skipTickets.value--
    return true
  }

  function addSkipTickets(count: number) {
    skipTickets.value += count
  }

  function getAnimationDuration(): number {
    const config = BATTLE_SPEEDS.find(s => s.multiplier === speedMultiplier.value)
    return config?.duration || 500
  }

  return { speedMultiplier, autoMode, skipTickets, setSpeed, toggleAuto, useSkipTicket, addSkipTickets, getAnimationDuration }
})
