import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { RebirthUpgrade, RebirthUpgradeLevel, RebirthStats, RebirthUpgradeCategory } from '../types'
import { useMonsterStore } from './monsterStore'
import { usePlayerStore } from './playerStore'

const SAVE_KEY = 'rebirth_data'

export const REBIRTH_UPGRADES: RebirthUpgrade[] = [
  // 科技类 - 战斗属性
  { id: 'crit_rate', category: 'tech', name: '暴击强化', description: '永久增加暴击率', maxLevel: 100, costPerLevel: 10, costScaling: 1.15, effectPerLevel: 0.5, icon: '💥' },
  { id: 'crit_damage', category: 'tech', name: '暴击强化', description: '永久增加暴击伤害', maxLevel: 100, costPerLevel: 10, costScaling: 1.15, effectPerLevel: 2, icon: '💥' },
  { id: 'penetration', category: 'tech', name: '护甲穿透', description: '永久增加穿透值', maxLevel: 100, costPerLevel: 15, costScaling: 1.2, effectPerLevel: 1, icon: '⚔️' },
  { id: 'accuracy', category: 'tech', name: '精准打击', description: '永久增加命中概率', maxLevel: 50, costPerLevel: 12, costScaling: 1.18, effectPerLevel: 0.3, icon: '🎯' },
  { id: 'dodge', category: 'tech', name: '灵活闪避', description: '永久增加闪避率', maxLevel: 50, costPerLevel: 12, costScaling: 1.18, effectPerLevel: 0.3, icon: '💨' },
  
  // 技能类 - 技能增强
  { id: 'skill_damage', category: 'skill', name: '技能增幅', description: '永久增加技能伤害', maxLevel: 100, costPerLevel: 20, costScaling: 1.25, effectPerLevel: 2, icon: '✨' },
  { id: 'skill_cooldown', category: 'skill', name: '技能冷却', description: '永久减少技能冷却', maxLevel: 50, costPerLevel: 25, costScaling: 1.3, effectPerLevel: 1, icon: '⏱️' },
  { id: 'skill_unlock', category: 'skill', name: '技能槽位', description: '解锁额外技能槽', maxLevel: 5, costPerLevel: 100, costScaling: 2, effectPerLevel: 1, icon: '🔮' },
  { id: 'boss_damage', category: 'skill', name: 'BOSS杀手', description: '对BOSS额外伤害', maxLevel: 50, costPerLevel: 30, costScaling: 1.25, effectPerLevel: 3, icon: '👹' },
  
  // 稀有乘区 - 装备和掉落
  { id: 'rarity_bonus', category: 'rarity', name: '稀有增幅', description: '提升装备稀有度', maxLevel: 50, costPerLevel: 50, costScaling: 1.5, effectPerLevel: 0.1, icon: '💎' },
  { id: 'gold_bonus', category: 'rarity', name: '财富加成', description: '增加金币获取', maxLevel: 100, costPerLevel: 15, costScaling: 1.2, effectPerLevel: 2, icon: '💰' },
  { id: 'exp_bonus', category: 'rarity', name: '经验加成', description: '增加经验获取', maxLevel: 100, costPerLevel: 15, costScaling: 1.2, effectPerLevel: 2, icon: '📚' },
  { id: 'diamond_bonus', category: 'rarity', name: '钻石加成', description: '增加钻石掉率', maxLevel: 30, costPerLevel: 40, costScaling: 1.35, effectPerLevel: 0.5, icon: '💠' },
  
  // 永久属性
  { id: 'attack_perm', category: 'permanent', name: '攻击强化', description: '永久增加攻击力', maxLevel: 200, costPerLevel: 5, costScaling: 1.1, effectPerLevel: 1, icon: '⚔️' },
  { id: 'defense_perm', category: 'permanent', name: '防御强化', description: '永久增加防御力', maxLevel: 200, costPerLevel: 5, costScaling: 1.1, effectPerLevel: 1, icon: '🛡️' },
  { id: 'hp_perm', category: 'permanent', name: '生命强化', description: '永久增加最大生命', maxLevel: 200, costPerLevel: 5, costScaling: 1.1, effectPerLevel: 5, icon: '❤️' },
]

export const useRebirthStore = defineStore('rebirth', () => {
  const rebirthPoints = ref(0)
  const totalRebirthCount = ref(0)
  const upgrades = ref<RebirthUpgradeLevel[]>([])
  const lastRebirthTime = ref(0)
  
  const rebirthStats = computed<RebirthStats>(() => {
    const stats: RebirthStats = {
      attackBonus: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      critRateBonus: 0,
      critDamageBonus: 0,
      penetrationBonus: 0,
      goldBonusPercent: 0,
      expBonusPercent: 0,
      equipmentRarityBonus: 0,
      skillDamageBonus: 0,
      bossDamageBonus: 0
    }
    
    for (const upgradeLevel of upgrades.value) {
      const upgrade = REBIRTH_UPGRADES.find(u => u.id === upgradeLevel.upgradeId)
      if (!upgrade) continue
      
      const effect = upgrade.effectPerLevel * upgradeLevel.currentLevel
      
      switch (upgrade.id) {
        case 'crit_rate':
          stats.critRateBonus += effect
          break
        case 'crit_damage':
          stats.critDamageBonus += effect
          break
        case 'penetration':
          stats.penetrationBonus += effect
          break
        case 'accuracy':
          stats.critRateBonus += effect * 0.3
          break
        case 'dodge':
          stats.critRateBonus += effect * 0.3
          break
        case 'skill_damage':
          stats.skillDamageBonus += effect
          break
        case 'boss_damage':
          stats.bossDamageBonus += effect
          break
        case 'rarity_bonus':
          stats.equipmentRarityBonus += effect
          break
        case 'gold_bonus':
          stats.goldBonusPercent += effect
          break
        case 'exp_bonus':
          stats.expBonusPercent += effect
          break
        case 'diamond_bonus':
          stats.goldBonusPercent += effect * 0.5
          break
        case 'attack_perm':
          stats.attackBonus += effect
          break
        case 'defense_perm':
          stats.defenseBonus += effect
          break
        case 'hp_perm':
          stats.maxHpBonus += effect
          break
      }
    }
    
    return stats
  })
  
  const getUpgradeLevel = (upgradeId: string): number => {
    const found = upgrades.value.find(u => u.upgradeId === upgradeId)
    return found ? found.currentLevel : 0
  }
  
  const getUpgradeCost = (upgradeId: string): number => {
    const upgrade = REBIRTH_UPGRADES.find(u => u.id === upgradeId)
    if (!upgrade) return Infinity
    const level = getUpgradeLevel(upgradeId)
    if (level >= upgrade.maxLevel) return Infinity
    return Math.floor(upgrade.costPerLevel * Math.pow(upgrade.costScaling, level))
  }
  
  const canAffordUpgrade = (upgradeId: string): boolean => {
    return rebirthPoints.value >= getUpgradeCost(upgradeId)
  }
  
  const purchaseUpgrade = (upgradeId: string): boolean => {
    const cost = getUpgradeCost(upgradeId)
    if (rebirthPoints.value < cost) return false
    
    const upgrade = REBIRTH_UPGRADES.find(u => u.id === upgradeId)
    if (!upgrade) return false
    
    const level = getUpgradeLevel(upgradeId)
    if (level >= upgrade.maxLevel) return false
    
    rebirthPoints.value -= cost
    
    const existing = upgrades.value.find(u => u.upgradeId === upgradeId)
    if (existing) {
      existing.currentLevel++
    } else {
      upgrades.value.push({ upgradeId, currentLevel: 1 })
    }
    
    saveRebirthData()
    return true
  }
  
  const getMaxSkillSlots = computed(() => {
    return 5 + getUpgradeLevel('skill_unlock')
  })
  
  function calculateRebirthPoints(difficultyValue: number): number {
    return Math.floor(Math.sqrt(difficultyValue + 1) * 10)
  }
  
  function performRebirth(): { pointsEarned: number } {
    const monsterStore = useMonsterStore()
    const playerStore = usePlayerStore()
    
    const pointsEarned = calculateRebirthPoints(monsterStore.difficultyValue)
    
    rebirthPoints.value += pointsEarned
    totalRebirthCount.value++
    lastRebirthTime.value = Date.now()
    
    playerStore.resetForRebirth()
    monsterStore.resetForRebirth()
    
    saveRebirthData()
    
    return { pointsEarned }
  }
  
  function resetRebirthData() {
    rebirthPoints.value = 0
    totalRebirthCount.value = 0
    upgrades.value = []
    lastRebirthTime.value = 0
    saveRebirthData()
  }
  
  function saveRebirthData() {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      rebirthPoints: rebirthPoints.value,
      totalRebirthCount: totalRebirthCount.value,
      upgrades: upgrades.value,
      lastRebirthTime: lastRebirthTime.value
    }))
  }
  
  function loadRebirthData() {
    try {
      const saved = localStorage.getItem(SAVE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        rebirthPoints.value = data.rebirthPoints || 0
        totalRebirthCount.value = data.totalRebirthCount || 0
        upgrades.value = data.upgrades || []
        lastRebirthTime.value = data.lastRebirthTime || 0
      }
    } catch (e) {
      console.error('Failed to load rebirth data:', e)
    }
  }
  
  function getUpgradesByCategory(category: RebirthUpgradeCategory): RebirthUpgrade[] {
    return REBIRTH_UPGRADES.filter(u => u.category === category)
  }
  
  loadRebirthData()
  
  return {
    rebirthPoints,
    totalRebirthCount,
    upgrades,
    lastRebirthTime,
    rebirthStats,
    getUpgradeLevel,
    getUpgradeCost,
    canAffordUpgrade,
    purchaseUpgrade,
    getMaxSkillSlots,
    calculateRebirthPoints,
    performRebirth,
    resetRebirthData,
    getUpgradesByCategory
  }
})
