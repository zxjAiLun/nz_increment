// T31.3 符文 Store
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { RUNES } from '../data/runes'
import type { Rune } from '../data/runes'
import type { Equipment } from '../types'

export const useRuneStore = defineStore('rune', () => {
  const inventory = ref<Rune[]>([])  // 背包中的符文

  function addRune(rune: Rune) {
    inventory.value.push(rune)
  }

  function embedRune(equipment: Equipment, slotIndex: number, runeId: string): boolean {
    const rune = inventory.value.find((r: Rune) => r.id === runeId)
    if (!rune) return false
    const slot = equipment.runeSlots[slotIndex]
    if (!slot || slot.runeId) return false  // 已有符文
    slot.runeId = runeId
    inventory.value = inventory.value.filter((r: Rune) => r.id !== runeId)
    return true
  }

  function removeRune(equipment: Equipment, slotIndex: number): Rune | null {
    const slot = equipment.runeSlots[slotIndex]
    if (!slot || !slot.runeId) return null
    const rune = inventory.value.find((r: Rune) => r.id === slot.runeId) || RUNES.find((r: Rune) => r.id === slot.runeId)
    slot.runeId = null
    return rune || null
  }

  function getRuneStats(equipment: Equipment): { stat: string; value: number }[] {
    const stats: { stat: string; value: number }[] = []
    for (const slot of equipment.runeSlots) {
      if (!slot.runeId) continue
      const rune = RUNES.find((r: Rune) => r.id === slot.runeId)
      if (rune) {
        stats.push(rune.primaryStat)
        if (rune.secondaryStat) stats.push(rune.secondaryStat)
      }
    }
    return stats
  }

  return { inventory, addRune, embedRune, removeRune, getRuneStats }
})
