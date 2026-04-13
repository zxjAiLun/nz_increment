import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Pet } from '../data/pets'
import { PETS } from '../data/pets'

// T77 宠物稀有度转数字
const RARITY_VALUE: Record<string, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legend: 4,
}

export const usePetStore = defineStore('pet', () => {
  const ownedPets = ref<Pet[]>([])
  const equippedPet = ref<Pet | null>(null)
  
  // T77 宠物经验系统
  const petExpTable = computed(() => {
    const table: number[] = [0]
    for (let i = 1; i <= 100; i++) {
      table[i] = table[i - 1] + Math.floor(100 * Math.pow(1.15, i))
    }
    return table
  })

  function capturePet(petId: string): boolean {
    const petData = PETS.find(p => p.id === petId)
    if (!petData) return false
    if (ownedPets.value.some(p => p.id === petId)) return false

    ownedPets.value.push({ ...petData, level: 1, exp: 0 })
    return true
  }

  function equipPet(petId: string): boolean {
    const pet = ownedPets.value.find(p => p.id === petId)
    if (!pet) return false
    equippedPet.value = pet
    return true
  }

  function unequipPet() {
    equippedPet.value = null
  }

  function evolvePet(petId: string): boolean {
    const pet = ownedPets.value.find(p => p.id === petId)
    if (!pet) return false
    if (pet.currentStage >= pet.evolutionStages) return false

    pet.currentStage++
    // Boost stats on evolution
    for (const stat in pet.baseStats) {
      pet.baseStats[stat as keyof typeof pet.baseStats] = Math.floor(pet.baseStats[stat as keyof typeof pet.baseStats] * 1.3)
    }
    return true
  }

  function getStats(pet: Pet): { attack: number; defense: number; maxHp: number; speed: number } {
    const level = pet.level || 1
    const multiplier = 1 + (pet.currentStage - 1) * 0.3 + (level - 1) * 0.05
    return {
      attack: Math.floor(pet.baseStats.attack * multiplier),
      defense: Math.floor(pet.baseStats.defense * multiplier),
      maxHp: Math.floor(pet.baseStats.maxHp * multiplier),
      speed: Math.floor(pet.baseStats.speed * multiplier),
    }
  }
  
  // T77 宠物喂养（增加经验）
  function feedPet(petId: string, expAmount: number): boolean {
    const pet = ownedPets.value.find(p => p.id === petId)
    if (!pet) return false
    
    pet.exp = (pet.exp || 0) + expAmount
    pet.level = pet.level || 1
    // 检查升级
    while (pet.level < 100 && pet.exp >= petExpTable.value[pet.level]) {
      pet.exp = (pet.exp || 0) - petExpTable.value[pet.level]
      pet.level++
    }
    return true
  }
  
  // T77 宠物融合（两只同星级宠物融合）
  function fusePets(petId1: string, petId2: string): Pet | null {
    const pet1 = ownedPets.value.find(p => p.id === petId1)
    const pet2 = ownedPets.value.find(p => p.id === petId2)
    if (!pet1 || !pet2) return null
    if (pet1.rarity !== pet2.rarity) return null
    if (RARITY_VALUE[pet1.rarity] >= 4) return null // 最高4星，不能融合
    
    const newRarity = RARITY_VALUE[pet1.rarity] + 1
    const rarityKeys = Object.keys(RARITY_VALUE) as Array<keyof typeof RARITY_VALUE>
    const newRarityStr = (rarityKeys.find(k => RARITY_VALUE[k] === newRarity) || 'rare') as Pet['rarity']
    
    // 创建新的更高星级宠物
    const newPet: Pet = {
      ...pet1,
      id: `fused_${Date.now()}`,
      name: `${pet1.name}+${pet2.name}`,
      rarity: newRarityStr,
      level: 1,
      exp: 0,
      currentStage: 1,
    }
    
    // 移除用于融合的两只宠物
    ownedPets.value = ownedPets.value.filter(p => p.id !== petId1 && p.id !== petId2)
    ownedPets.value.push(newPet)
    
    return newPet
  }
  
  // T77 宠物放生（获得经验道具）
  function releasePet(petId: string): number {
    const pet = ownedPets.value.find(p => p.id === petId)
    if (!pet) return 0
    
    const level = pet.level || 1
    const expReward = Math.floor(petExpTable.value[level] * 0.5)
    ownedPets.value = ownedPets.value.filter(p => p.id !== petId)
    if (equippedPet.value?.id === petId) {
      equippedPet.value = null
    }
    return expReward
  }

  return { 
    ownedPets, 
    equippedPet, 
    capturePet, 
    equipPet, 
    unequipPet, 
    evolvePet, 
    getStats,
    feedPet,
    fusePets,
    releasePet,
    petExpTable,
  }
})
