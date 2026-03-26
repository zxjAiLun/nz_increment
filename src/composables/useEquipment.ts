import { usePlayerStore } from '../stores/playerStore'
import type { EquipmentSlot, Equipment } from '../types'

export function useEquipment() {
  const playerStore = usePlayerStore()
  
  function equipItem(equipment: Equipment) {
    playerStore.equipItem(equipment)
  }
  
  function unequipItem(slot: EquipmentSlot) {
    playerStore.unequipItem(slot)
  }
  
  function getEquippedItem(slot: EquipmentSlot): Equipment | null {
    return playerStore.player.equipment[slot] || null
  }
  
  function canEquip(slot: EquipmentSlot): boolean {
    return !playerStore.player.equipment[slot]
  }
  
  return {
    equipItem,
    unequipItem,
    getEquippedItem,
    canEquip
  }
}
