import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { RebirthUpgrade, RebirthUpgradeLevel, RebirthStats, RebirthUpgradeCategory } from '../types'
import { useMonsterStore } from './monsterStore'
import { usePlayerStore } from './playerStore'
import { compensateStorageRaws } from '../utils/storageCompensation'

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

// Phase 3.59：启动水合专用 fail-closed 规范化。
function normalizeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0
}

function normalizeRebirthUpgradeLevels(value: unknown): RebirthUpgradeLevel[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: RebirthUpgradeLevel[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const id = record.upgradeId
    if (typeof id !== 'string' || id === '') return []
    const upgrade = REBIRTH_UPGRADES.find(u => u.id === id)
    if (!upgrade) return []
    const level = record.currentLevel
    if (!Number.isSafeInteger(level) || (level as number) < 1 || (level as number) > upgrade.maxLevel) return []
    if (seen.has(id)) return []
    seen.add(id)
    result.push({ upgradeId: id, currentLevel: level as number })
  }
  return result
}

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
    // Phase 3.54：购买事务前置校验（全部在 mutation / 存储之前，fail-closed）。
    if (typeof upgradeId !== 'string' || upgradeId === '') return false

    const upgrade = REBIRTH_UPGRADES.find(u => u.id === upgradeId)
    if (!upgrade) return false

    const points = rebirthPoints.value
    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) return false

    const matches = upgrades.value.filter(u => u.upgradeId === upgradeId)
    if (matches.length > 1) return false

    if (matches.length === 1) {
      const currentLevel = matches[0].currentLevel
      if (!Number.isFinite(currentLevel) || !Number.isInteger(currentLevel) || currentLevel < 0) return false
      if (currentLevel >= upgrade.maxLevel) return false
    }

    const cost = Math.floor(upgrade.costPerLevel * Math.pow(upgrade.costScaling, matches.length === 1 ? matches[0].currentLevel : 0))
    if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost <= 0) return false
    if (points < cost) return false

    const previousPoints = rebirthPoints.value
    const previousUpgrades = upgrades.value
    const nextUpgrades = upgrades.value.map(item => ({ ...item }))

    const existing = nextUpgrades.find(u => u.upgradeId === upgradeId)
    if (existing) {
      existing.currentLevel += 1
    } else {
      nextUpgrades.push({ upgradeId, currentLevel: 1 })
    }

    rebirthPoints.value = previousPoints - cost
    upgrades.value = nextUpgrades

    try {
      saveRebirthData()
    } catch {
      rebirthPoints.value = previousPoints
      upgrades.value = previousUpgrades
      return false
    }

    return true
  }
  
  const getMaxSkillSlots = computed(() => {
    return 5 + getUpgradeLevel('skill_unlock')
  })
  
  function calculateRebirthPoints(difficultyValue: number): number {
    return Math.floor(Math.sqrt(difficultyValue + 1) * 10)
  }
  
  function performRebirth(): { pointsEarned: number } | null {
    const monsterStore = useMonsterStore()
    const difficulty = monsterStore.difficultyValue

    // Phase 3.53：资格门（权威，不依赖 UI disabled）。非有限或 <10 → 预期拒绝，返回 null，
    // 零状态修改、零存储写入。
    if (!Number.isFinite(difficulty) || difficulty < 10) {
      return null
    }

    const playerStore = usePlayerStore()

    // Phase 3.58：跨 Store 同步补偿事务。任何 mutation 之前先完整快照内存与旧 rebirth key；
    // 任一同步失败都精确回滚内存，并在主存档失败时补偿恢复 rebirth_data，再抛异常进入既有
    // App fail-stop。注意：只保证一次同步调用内的失败原子性，不宣称跨 localStorage key 的
    // 断电级 ACID。
    const previousPoints = rebirthPoints.value
    const previousCount = totalRebirthCount.value
    const previousTime = lastRebirthTime.value

    const previousPlayer = playerStore.player
    const previousPending = playerStore.pendingOfflineReward
    const previousBuffs = playerStore.activeBuffs
    const previousCounts = playerStore.statUpgradeCounts

    const previousMonster = monsterStore.currentMonster
    const previousEncounterId = monsterStore.currentEncounterId
    const previousMonsterAction = monsterStore.monsterAction
    const previousLastMonsterAction = monsterStore.lastMonsterAction

    // 旧 rebirth key 快照必须在任何 mutation 前读取；getItem 本身抛错 → 零 mutation 原异常外抛。
    const previousRebirthRaw = localStorage.getItem('rebirth_data')

    const pointsEarned = calculateRebirthPoints(difficulty)

    function rollbackMemory() {
      rebirthPoints.value = previousPoints
      totalRebirthCount.value = previousCount
      lastRebirthTime.value = previousTime

      playerStore.player = previousPlayer
      playerStore.pendingOfflineReward = previousPending
      playerStore.activeBuffs = previousBuffs
      playerStore.statUpgradeCounts = previousCounts

      monsterStore.currentMonster = previousMonster
      monsterStore.currentEncounterId = previousEncounterId
      monsterStore.monsterAction = previousMonsterAction
      monsterStore.lastMonsterAction = previousLastMonsterAction
    }

    // 补偿恢复旧 rebirth key，只尝试一次；恢复自身失败抛固定分类错误（内存已回滚）。
    function restoreRebirthRaw() {
      compensateStorageRaws([['rebirth_data', previousRebirthRaw]], 'rebirth persistence rollback failed')
    }

    // 候选应用：任一步 throw → 内存回滚 + 原异常重新抛出，零持久化、不 retry。
    try {
      rebirthPoints.value = previousPoints + pointsEarned
      totalRebirthCount.value = previousCount + 1
      lastRebirthTime.value = Date.now()

      playerStore.resetForRebirth()
      monsterStore.resetForRebirth()
    } catch (error) {
      rollbackMemory()
      throw error
    }

    // 持久化顺序：先写 rebirth_data（本 store 可安全补偿恢复），主存档最后写。
    try {
      saveRebirthData()
    } catch (error) {
      rollbackMemory()
      throw error
    }

    let saved: boolean
    try {
      saved = playerStore.saveGame()
    } catch (error) {
      const originalError = error
      rollbackMemory()
      restoreRebirthRaw()
      throw originalError
    }

    if (!saved) {
      rollbackMemory()
      restoreRebirthRaw()
      throw new Error('rebirth main save failed')
    }

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
    let candidate = {
      rebirthPoints: 0,
      totalRebirthCount: 0,
      upgrades: [] as RebirthUpgradeLevel[],
      lastRebirthTime: 0
    }
    try {
      const saved = localStorage.getItem(SAVE_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>
          candidate = {
            rebirthPoints: normalizeNonNegativeInteger(record.rebirthPoints),
            totalRebirthCount: normalizeNonNegativeInteger(record.totalRebirthCount),
            upgrades: normalizeRebirthUpgradeLevels(record.upgrades),
            lastRebirthTime: normalizeNonNegativeInteger(record.lastRebirthTime)
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization 意外 throw → 保持默认 candidate
    }
    // Phase 3.59：全部 parse/normalization 完成后一次性提交，杜绝部分水合。
    rebirthPoints.value = candidate.rebirthPoints
    totalRebirthCount.value = candidate.totalRebirthCount
    upgrades.value = candidate.upgrades
    lastRebirthTime.value = candidate.lastRebirthTime
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
