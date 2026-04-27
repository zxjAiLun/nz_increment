import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { TALENT_BRANCHES, TALENT_NODES, TALENTS, type Talent, type TalentBranchId, type TalentEffectType, type TalentNode, type TalentSpecialEffect } from '../data/talents'
import type { StatType } from '../types'

const TALENT_SAVE_KEY = 'nz_talent_tree_v2'

export interface TalentStatBonus {
  stat: StatType
  value: number
  type: TalentEffectType
}

export type TalentSpecialBonuses = Record<TalentSpecialEffect, number>

function createEmptySpecialBonuses(): TalentSpecialBonuses {
  return {
    deathSetbackReduction: 0,
    safeModeBonusSeconds: 0,
    fatigueReductionPercent: 0,
    goldBonusPercent: 0,
    equipmentDropBonusPercent: 0,
    rarityBonus: 0
  }
}

export const useTalentStore = defineStore('talent', () => {
  const talentPoints = ref(10)
  const talentLevels = ref<Record<string, number>>({})
  const bossTalentRewards = ref<string[]>([])

  const unlockedTalents = computed(() => Object.entries(talentLevels.value)
    .filter(([, level]) => level > 0)
    .map(([id]) => id)
  )

  const spentPoints = computed(() => TALENT_NODES.reduce((sum, node) => {
    return sum + (talentLevels.value[node.id] ?? 0) * node.costPerLevel
  }, 0))

  const branchSummaries = computed(() => TALENT_BRANCHES.map(branch => {
    const nodes = TALENT_NODES.filter(node => node.branch === branch.id)
    const spent = nodes.reduce((sum, node) => sum + (talentLevels.value[node.id] ?? 0) * node.costPerLevel, 0)
    const levels = nodes.reduce((sum, node) => sum + (talentLevels.value[node.id] ?? 0), 0)
    return { ...branch, spent, levels }
  }))

  function save() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TALENT_SAVE_KEY, JSON.stringify({
      talentPoints: talentPoints.value,
      talentLevels: talentLevels.value,
      bossTalentRewards: bossTalentRewards.value
    }))
  }

  function load() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(TALENT_SAVE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed.talentPoints === 'number') talentPoints.value = parsed.talentPoints
      if (parsed.talentLevels && typeof parsed.talentLevels === 'object') talentLevels.value = parsed.talentLevels
      if (Array.isArray(parsed.bossTalentRewards)) bossTalentRewards.value = parsed.bossTalentRewards
    } catch {
      // Ignore invalid legacy talent saves.
    }
  }

  load()

  function getTalentPoints(): number {
    return talentPoints.value
  }

  function getNode(talentId: string): TalentNode | undefined {
    return TALENT_NODES.find(node => node.id === talentId)
  }

  function getLevel(talentId: string): number {
    return talentLevels.value[talentId] ?? 0
  }

  function isMaxed(talentId: string): boolean {
    const node = getNode(talentId)
    return !!node && getLevel(talentId) >= node.maxLevel
  }

  function isUnlocked(talentId: string): boolean {
    return getLevel(talentId) > 0
  }

  function prerequisitesMet(node: TalentNode): boolean {
    return (node.prerequisites ?? []).every(id => getLevel(id) > 0)
  }

  function canUnlock(talentId: string): boolean {
    const node = getNode(talentId)
    if (!node) return false
    if (isMaxed(talentId)) return false
    if (talentPoints.value < node.costPerLevel) return false
    return prerequisitesMet(node)
  }

  function upgradeTalent(talentId: string): boolean {
    const node = getNode(talentId)
    if (!node || !canUnlock(talentId)) return false
    talentPoints.value -= node.costPerLevel
    talentLevels.value = {
      ...talentLevels.value,
      [talentId]: getLevel(talentId) + 1
    }
    save()
    return true
  }

  function spendPoint(talentId: string): boolean {
    return upgradeTalent(talentId)
  }

  function getTalentsByTier(tier: number): Talent[] {
    return TALENTS.filter(talent => talent.tier === tier)
  }

  function getNodesByBranch(branch: TalentBranchId): TalentNode[] {
    return TALENT_NODES.filter(node => node.branch === branch)
  }

  function addTalentPoints(amount: number) {
    talentPoints.value += Math.max(0, Math.floor(amount))
    save()
  }

  function grantBossTalentPoint(bossKey: string): boolean {
    if (bossTalentRewards.value.includes(bossKey)) return false
    bossTalentRewards.value.push(bossKey)
    talentPoints.value += 1
    save()
    return true
  }

  function getStatBonuses(): TalentStatBonus[] {
    const bonuses: TalentStatBonus[] = []
    for (const node of TALENT_NODES) {
      const level = getLevel(node.id)
      if (level <= 0) continue
      for (const effect of node.effects) {
        if (!effect.stat) continue
        bonuses.push({
          stat: effect.stat,
          value: effect.value * level,
          type: effect.type ?? 'flat'
        })
      }
    }
    return bonuses
  }

  function getSpecialBonuses(): TalentSpecialBonuses {
    const bonuses = createEmptySpecialBonuses()
    for (const node of TALENT_NODES) {
      const level = getLevel(node.id)
      if (level <= 0) continue
      for (const effect of node.effects) {
        if (!effect.special) continue
        bonuses[effect.special] += effect.value * level
      }
    }
    return bonuses
  }

  function resetTalents() {
    const refunded = spentPoints.value
    talentLevels.value = {}
    talentPoints.value += refunded
    save()
  }

  return {
    talentPoints,
    talentLevels,
    unlockedTalents,
    spentPoints,
    branchSummaries,
    getTalentPoints,
    getNode,
    getLevel,
    isMaxed,
    isUnlocked,
    canUnlock,
    upgradeTalent,
    spendPoint,
    getTalentsByTier,
    getNodesByBranch,
    addTalentPoints,
    grantBossTalentPoint,
    getStatBonuses,
    getSpecialBonuses,
    resetTalents
  }
})
