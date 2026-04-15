import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SKILL_SKINS } from '../data/skillSkins'
import type { SkillSkin } from '../data/skillSkins'

export const useSkillSkinStore = defineStore('skillSkin', () => {
  const ownedSkins = ref<string[]>([])
  const equippedSkins = ref<{ [skillId: string]: string }>({})

  function unlockSkin(skinId: string): boolean {
    if (ownedSkins.value.includes(skinId)) return false
    ownedSkins.value.push(skinId)
    return true
  }

  function equipSkin(skillId: string, skinId: string): boolean {
    if (!ownedSkins.value.includes(skinId)) return false
    const skin = SKILL_SKINS.find(s => s.id === skinId)
    if (!skin || skin.skillId !== skillId) return false
    equippedSkins.value[skillId] = skinId
    return true
  }

  function unequipSkin(skillId: string) {
    delete equippedSkins.value[skillId]
  }

  function getEquippedSkin(skillId: string): SkillSkin | null {
    const skinId = equippedSkins.value[skillId]
    if (!skinId) return null
    return SKILL_SKINS.find(s => s.id === skinId) || null
  }

  function isOwned(skinId: string): boolean {
    return ownedSkins.value.includes(skinId)
  }

  function canUnlock(skin: SkillSkin, playerData: any): boolean {
    if (isOwned(skin.id)) return false
    if (skin.unlockType === 'purchase') return true
    if (skin.unlockType === 'reputation') return (playerData.reputationLevel || 0) >= (skin.reputationLevel || 0)
    return true
  }

  return { ownedSkins, equippedSkins, unlockSkin, equipSkin, unequipSkin, getEquippedSkin, isOwned, canUnlock }
})
