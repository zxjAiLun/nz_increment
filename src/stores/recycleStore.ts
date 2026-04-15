import { defineStore } from 'pinia'
import { ref } from 'vue'
import { RECYCLE_MATERIALS, RECYCLE_RECIPES } from '../data/recycleMaterials'
import type { RecycleMaterial } from '../data/recycleMaterials'

export const useRecycleStore = defineStore('recycle', () => {
  const materials = ref<{ [id: string]: number }>({})

  function getMaterialCount(id: string): number {
    return materials.value[id] || 0
  }

  function addMaterial(id: string, amount: number) {
    if (!materials.value[id]) materials.value[id] = 0
    materials.value[id] += amount
  }

  // 分解装备
  function recycleEquipment(equipment: { rarity: string }): { dust: number; essence: number } {
    const recipe = RECYCLE_RECIPES[equipment.rarity as keyof typeof RECYCLE_RECIPES]
    if (!recipe) return { dust: 0, essence: 0 }

    addMaterial('dust_common', recipe.dust)
    addMaterial('essence_common', recipe.essence)

    return recipe
  }

  // 合成 (消耗材料换取更稀有材料)
  function canCraft(targetId: string): boolean {
    const target = RECYCLE_MATERIALS.find(m => m.id === targetId)
    if (!target) return false

    if (target.rarity === 'common') return false  // 不能合成普通

    // 消耗3个低一级的同类型材料
    const sources = getSourcesForRarity(target.rarity)
    return sources.every(s => getMaterialCount(s.id) >= 3)
  }

  function getSourcesForRarity(_rarity: string): RecycleMaterial[] {
    return RECYCLE_MATERIALS.filter(m => m.rarity === 'common')
  }

  function craft(targetId: string): boolean {
    if (!canCraft(targetId)) return false

    const target = RECYCLE_MATERIALS.find(m => m.id === targetId)!
    const sources = getSourcesForRarity(target.rarity)

    // 消耗材料
    sources.forEach(s => {
      materials.value[s.id] = (materials.value[s.id] || 0) - 3
    })

    // 获得目标
    addMaterial(targetId, 1)
    return true
  }

  return { materials, getMaterialCount, recycleEquipment, canCraft, craft }
})
