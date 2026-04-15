import { EQUIPMENT_SETS, type SetEffect } from '../data/equipmentSets'
import type { Equipment, EquipmentSlot } from '../types'

export interface ActiveSetBonus {
  setId: string
  setName: string
  tier: 2 | 3 | 5
  effect: SetEffect
}

export function calculateActiveSets(equipment: Partial<Record<EquipmentSlot, Equipment>>): ActiveSetBonus[] {
  const activeBonuses: ActiveSetBonus[] = []

  for (const set of EQUIPMENT_SETS) {
    // Count how many slots from this set the player has equipped
    const equippedCount = set.slots.filter(slot => equipment[slot] !== null).length

    // Activate 2-piece bonus
    if (equippedCount >= 2 && set.effects[2]) {
      activeBonuses.push({ setId: set.id, setName: set.name, tier: 2, effect: set.effects[2] })
    }
    // Activate 3-piece bonus
    if (equippedCount >= 3 && set.effects[3]) {
      activeBonuses.push({ setId: set.id, setName: set.name, tier: 3, effect: set.effects[3] })
    }
    // Activate 5-piece bonus
    if (equippedCount >= 5 && set.effects[5]) {
      activeBonuses.push({ setId: set.id, setName: set.name, tier: 5, effect: set.effects[5] })
    }
  }

  return activeBonuses
}

export function getSetName(setId: string): string {
  return EQUIPMENT_SETS.find(s => s.id === setId)?.name || setId
}
