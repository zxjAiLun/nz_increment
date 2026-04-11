import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Pet } from '../data/pets'
import { PETS } from '../data/pets'

export const usePetStore = defineStore('pet', () => {
  const ownedPets = ref<Pet[]>([])
  const equippedPet = ref<Pet | null>(null)

  function capturePet(petId: string): boolean {
    const petData = PETS.find(p => p.id === petId)
    if (!petData) return false
    if (ownedPets.value.some(p => p.id === petId)) return false

    ownedPets.value.push({ ...petData })
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
    const multiplier = 1 + (pet.currentStage - 1) * 0.3
    return {
      attack: Math.floor(pet.baseStats.attack * multiplier),
      defense: Math.floor(pet.baseStats.defense * multiplier),
      maxHp: Math.floor(pet.baseStats.maxHp * multiplier),
      speed: Math.floor(pet.baseStats.speed * multiplier),
    }
  }

  return { ownedPets, equippedPet, capturePet, equipPet, unequipPet, evolvePet, getStats }
})
