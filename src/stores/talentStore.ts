import { defineStore } from 'pinia'
import { ref } from 'vue'
import { TALENTS, type Talent } from '../data/talents'

export const useTalentStore = defineStore('talent', () => {
  const talentPoints = ref(5)  // 初始5点
  const unlockedTalents = ref<string[]>([])

  function getTalentPoints(): number {
    return talentPoints.value
  }

  function spendPoint(talentId: string): boolean {
    const talent = TALENTS.find(t => t.id === talentId)
    if (!talent) return false
    if (unlockedTalents.value.includes(talentId)) return false
    if (talentPoints.value < talent.cost) return false

    // 检查前置天赋
    if (talent.prerequisite && !unlockedTalents.value.includes(talent.prerequisite)) return false

    talentPoints.value -= talent.cost
    unlockedTalents.value.push(talentId)
    return true
  }

  function isUnlocked(talentId: string): boolean {
    return unlockedTalents.value.includes(talentId)
  }

  function canUnlock(talentId: string): boolean {
    const talent = TALENTS.find(t => t.id === talentId)
    if (!talent) return false
    if (unlockedTalents.value.includes(talentId)) return false
    if (talentPoints.value < talent.cost) return false
    if (talent.prerequisite && !unlockedTalents.value.includes(talent.prerequisite)) return false
    return true
  }

  function getTalentsByTier(tier: number): Talent[] {
    return TALENTS.filter(t => t.tier === tier)
  }

  function addTalentPoints(amount: number) {
    talentPoints.value += amount
  }

  return { talentPoints, unlockedTalents, getTalentPoints, spendPoint, isUnlocked, canUnlock, getTalentsByTier, addTalentPoints }
})
