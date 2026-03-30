import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Player, PlayerStats, Equipment, EquipmentSlot, Skill, StatType } from '../types'
import { createDefaultPlayer, calculateTotalStats, calculateOfflineReward, isEquipmentBetter, calculateRecyclePrice, calculateHealing, calculateLuckEffects, calculateEquipmentScore } from '../utils/calc'
import { generateEquipment, generateRandomRarity } from '../utils/equipmentGenerator'
import { EQUIPMENT_SLOTS, PHASE_UNLOCK, STAT_CATEGORY, STAT_NAMES } from '../types'
import { getUnlockedSkills, createSkillInstance } from '../utils/skillSystem'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useRebirthStore } from './rebirthStore'

const SAVE_KEY = 'lollipop_adventure_save'

export const usePlayerStore = defineStore('player', () => {
  const player = ref<Player>(createDefaultPlayer())
  const pendingOfflineReward = ref<{ gold: number; exp: number } | null>(null)
  const activeBuffs = ref<Map<StatType, { value: number; endTime: number }>>(new Map())
  const statUpgradeCounts = ref<Map<StatType, number>>(new Map())
  const pendingEquipment = ref<Equipment | null>(null)
  
  const totalStats = computed<PlayerStats>(() => {
    const stats = calculateTotalStats(player.value)
    const rebirthStore = useRebirthStore()
    const rebirthStats = rebirthStore.rebirthStats
    
    const now = Date.now()
    for (const [stat, buff] of activeBuffs.value) {
      if (now < buff.endTime) {
        stats[stat] = stats[stat] * (1 + buff.value / 100)
      }
    }
    
    stats.attack += rebirthStats.attackBonus
    stats.defense += rebirthStats.defenseBonus
    stats.maxHp += rebirthStats.maxHpBonus
    stats.critRate += rebirthStats.critRateBonus
    stats.critDamage += rebirthStats.critDamageBonus
    stats.penetration += rebirthStats.penetrationBonus
    
    return stats
  })

  watch(
    () => totalStats.value.maxHp,
    (newMaxHp) => {
      if (player.value.maxHp !== newMaxHp) {
        player.value.maxHp = newMaxHp
        if (player.value.currentHp > newMaxHp) {
          player.value.currentHp = newMaxHp
        }
      }
    },
    { immediate: true }
  )

  function pruneExpiredBuffs() {
    const now = Date.now()
    for (const [stat, buff] of activeBuffs.value) {
      if (now >= buff.endTime) {
        activeBuffs.value.delete(stat)
      }
    }
  }
  
  function loadGame() {
    try {
      const saved = localStorage.getItem(SAVE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        const defaultPlayer = createDefaultPlayer()
        player.value = {
          ...defaultPlayer,
          ...data.player,
          skills: Array.isArray(data.player.skills) ? data.player.skills : [null, null, null, null, null],
          stats: {
            ...defaultPlayer.stats,
            ...data.player.stats
          }
        }

        // 加载怪物进度
        if (data.monsterData) {
          const monsterStore = useMonsterStore()
          monsterStore.setProgress(
            data.monsterData.difficultyValue || 0,
            data.monsterData.monsterLevel || 1
          )
        } else {
        }

        // 加载游戏数据
        if (data.gameData) {
          const gameStore = useGameStore()
          if (data.gameData.damageStats) {
            gameStore.damageStats = data.gameData.damageStats
          }
          if (data.gameData.battleLog) {
            gameStore.battleLog = data.gameData.battleLog
          }
        }

        // 加载练功房进度
        if (data.trainingData) {
          const trainingStore = useTrainingStore()
          if (data.trainingData.trainingLevel) {
            trainingStore.trainingLevel = data.trainingData.trainingLevel
          }
          if (data.trainingData.trainingDifficulty) {
            trainingStore.trainingDifficulty = data.trainingData.trainingDifficulty
          }
        }

        if (data.pendingOfflineReward) {
          pendingOfflineReward.value = data.pendingOfflineReward
        }

        const offlineSeconds = (Date.now() - player.value.lastLoginTime) / 1000
        if (offlineSeconds > 60) {
          pendingOfflineReward.value = calculateOfflineReward(player.value, offlineSeconds)
          player.value.totalOfflineTime += offlineSeconds
        }

        player.value.lastLoginTime = Date.now()
      } else {
      }
    } catch (e) {
      player.value = createDefaultPlayer()
    }
  }
  
  function saveGame() {
    const monsterStore = useMonsterStore()
    const gameStore = useGameStore()
    const trainingStore = useTrainingStore()

    const saveData = {
      player: player.value,
      pendingOfflineReward: pendingOfflineReward.value,
      monsterData: {
        difficultyValue: monsterStore.difficultyValue,
        monsterLevel: monsterStore.monsterLevel
      },
      gameData: {
        damageStats: gameStore.damageStats,
        battleLog: gameStore.battleLog
      },
      trainingData: {
        trainingLevel: trainingStore.trainingLevel,
        trainingDifficulty: trainingStore.trainingDifficulty
      }
    }

    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData))
  }
  
  function claimOfflineReward() {
    if (pendingOfflineReward.value) {
      player.value.gold += pendingOfflineReward.value.gold
      player.value.experience += pendingOfflineReward.value.exp
      pendingOfflineReward.value = null
      saveGame()
    }
  }
  
  function addGold(amount: number) {
    const rebirthStore = useRebirthStore()
    const luckEffects = calculateLuckEffects(player.value.stats.luck)
    const rebirthBonus = rebirthStore.rebirthStats.goldBonusPercent / 100
    const bonusAmount = Math.floor(amount * (luckEffects.goldBonus + rebirthBonus))
    player.value.gold += amount + bonusAmount
  }
  
  function addDiamond(amount: number) {
    player.value.diamond += amount
  }

  function addStatReward(statType: 'attack' | 'defense' | 'maxHp' | 'speed', amount: number) {
    player.value.stats[statType] += amount
  }

  function addExperience(amount: number) {
    const rebirthStore = useRebirthStore()
    const rebirthBonus = rebirthStore.rebirthStats.expBonusPercent / 100
    const bonusAmount = Math.floor(amount * rebirthBonus)
    player.value.experience += amount + bonusAmount
    checkLevelUp()
  }
  
  function getExpNeeded(): number {
    return player.value.level * 100 * Math.pow(1.5, player.value.level - 1)
  }
  
  function getPlayerPhase(): number {
    return Math.min(Math.floor(player.value.level / 5) + 1, 7)
  }
  
  function getExpPerSecond(): number {
    const phase = getPlayerPhase()
    const baseExp = Math.pow(2, phase - 1)
    return baseExp
  }
  
  function getExpPerKill(): number {
    const phase = getPlayerPhase()
    return Math.floor(10 * Math.pow(1.5, phase - 1))
  }
  
  function getAverageExpPerSecond(): number {
    const expPerSec = getExpPerSecond()
    const monsterStore = useMonsterStore()
    const monster = monsterStore.currentMonster
    if (monster) {
      const killsPerSecond = monster.speed / 100
      const expFromKills = getExpPerKill() * killsPerSecond
      return expPerSec + expFromKills
    }
    return expPerSec
  }
  
  function getSecondsToLevelUp(): number {
    const expNeeded = getExpNeeded()
    const currentExp = player.value.experience
    const expNeededRemaining = expNeeded - currentExp
    const expPerSec = getAverageExpPerSecond()
    if (expPerSec <= 0) return Infinity
    return Math.ceil(expNeededRemaining / expPerSec)
  }
  
  function checkLevelUp() {
    const expNeeded = player.value.level * 100 * Math.pow(1.5, player.value.level - 1)
    while (player.value.experience >= expNeeded) {
      player.value.experience -= expNeeded
      player.value.level++
      player.value.stats.attack += 2
      player.value.stats.defense += 2
      player.value.stats.maxHp += 20
      player.value.stats.speed += 1
      checkPhaseUnlock()
    }
  }
  
  function checkPhaseUnlock() {
    const newPhase = Math.min(Math.floor(player.value.level / 5) + 1, 7)
    for (let p = 1; p <= newPhase; p++) {
      if (!player.value.unlockedPhases.includes(p)) {
        player.value.unlockedPhases.push(p)
      }
    }
  }
  
  function isStatUnlocked(stat: StatType): boolean {
    const category = STAT_CATEGORY[stat]
    const requiredPhase = PHASE_UNLOCK[category]
    return player.value.unlockedPhases.includes(requiredPhase)
  }
  
  function equipItem(equipment: Equipment) {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (currentEquip && !currentEquip.isLocked) {
      const recycleGold = calculateRecyclePrice(currentEquip)
      player.value.gold += recycleGold
    }
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    }
    return false
  }
  
  function autoEquipIfBetter(equipment: Equipment): boolean {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      if (currentEquip && !currentEquip.isLocked) {
        const recycleGold = calculateRecyclePrice(currentEquip)
        player.value.gold += recycleGold
      }
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      return true
    }
    return false
  }
  
  function unequipItem(slot: EquipmentSlot) {
    const equip = player.value.equipment[slot]
    if (equip) {
      const recycleGold = calculateRecyclePrice(equip)
      player.value.gold += recycleGold
      delete player.value.equipment[slot]
      saveGame()
    }
  }
  
  function toggleEquipLock(slot: EquipmentSlot) {
    const equip = player.value.equipment[slot]
    if (equip) {
      equip.isLocked = !equip.isLocked
      saveGame()
    }
  }
  
  function upgradeStat(stat: StatType, goldAmount: number): boolean {
    if (!isStatUnlocked(stat)) return false
    
    if (player.value.gold < goldAmount) return false
    
    const currentCount = statUpgradeCounts.value.get(stat) || 0
    const pointsToGain = Math.floor(Math.log10(goldAmount + 1) * 2) + 1
    
    if (pointsToGain <= 0) return false
    
    player.value.gold -= goldAmount
    player.value.stats[stat] += pointsToGain
    statUpgradeCounts.value.set(stat, currentCount + 1)
    saveGame()
    return true
  }
  
  function getUpgradeCost(stat: StatType): number {
    const currentCount = statUpgradeCounts.value.get(stat) || 0
    return Math.floor(Math.pow(10, currentCount + 1))
  }
  
  function getPointsForGold(stat: StatType): number {
    const gold = getUpgradeCost(stat)
    return Math.floor(Math.log10(gold + 1) * 2) + 1
  }
  
  function canUpgradeStat(stat: StatType): boolean {
    if (!isStatUnlocked(stat)) return false
    return player.value.gold >= getUpgradeCost(stat)
  }
  
  function generateRandomEquipment(): Equipment | null {
    const monsterStore = useMonsterStore()
    const rebirthStore = useRebirthStore()
    const slot = EQUIPMENT_SLOTS[Math.floor(Math.random() * EQUIPMENT_SLOTS.length)]
    const rarity = generateRandomRarity(rebirthStore.rebirthStats.equipmentRarityBonus)
    const difficulty = monsterStore.difficultyValue || 1
    return generateEquipment(slot, rarity, difficulty)
  }
  
  function equipNewEquipment(equipment: Equipment): boolean {
    const slot = equipment.slot
    const currentEquip = player.value.equipment[slot] ?? null
    
    if (isEquipmentBetter(equipment, currentEquip)) {
      if (currentEquip && !currentEquip.isLocked) {
        const recycleGold = calculateRecyclePrice(currentEquip)
        player.value.gold += recycleGold
      }
      player.value.equipment[slot] = equipment
      saveGame()
      pendingEquipment.value = null
      return true
    } else if (!currentEquip) {
      player.value.equipment[slot] = equipment
      saveGame()
      pendingEquipment.value = null
      return true
    }
    return false
  }

function getLotteryCost(): number {
    const monsterStore = useMonsterStore()
    const difficulty = Math.max(1, monsterStore.difficultyValue)
    // 调整为更平缓的增长曲线，10 * 1.005^difficulty
    // difficulty 100 时单抽约 16 金币，十连约 128 金币
    return Math.floor(10 * Math.pow(1.005, difficulty))
  }

  function getLottery10Cost(): number {
    return Math.floor(getLotteryCost() * 10)
  }
  
  type LotteryRewardType = 'equipment' | 'stat' | 'gold' | 'exp'
  interface LotteryReward {
    type: LotteryRewardType
    description: string
    equipment?: Equipment
    statType?: StatType
    statValue?: number
    goldAmount?: number
    expAmount?: number
  }
  
  function doLottery(): LotteryReward | null {
    const cost = getLotteryCost()
    if (player.value.gold < cost) return null
    
    player.value.gold -= cost
    
    const phase = Math.min(Math.floor(player.value.level / 5) + 1, 7)
    const phaseMultiplier = Math.pow(10, phase - 1)
    
    const roll = Math.random() * 100
    
    if (roll < 40) {
      const equipment = generateRandomEquipment()
      if (equipment) {
        const equipped = equipNewEquipment(equipment)
        if (equipped) {
          return { type: 'equipment', description: `装备: ${equipment.name} (已装备)`, equipment }
        } else {
          const slot = equipment.slot
          const currentEquip = player.value.equipment[slot]
          const newScore = calculateEquipmentScore(equipment)
          const currentScore = currentEquip ? calculateEquipmentScore(currentEquip) : 0
          return { type: 'equipment', description: `装备: ${equipment.name} (战力${Math.floor(newScore)}<${Math.floor(currentScore)}未替换)`, equipment }
        }
      }
    }
    
    if (roll < 70) {
      const statTypes: StatType[] = ['attack', 'defense', 'maxHp', 'speed']
      const stat = statTypes[Math.floor(Math.random() * statTypes.length)]
      const value = Math.floor((Math.random() * 5 + 1) * Math.min(phaseMultiplier, 100))
      player.value.stats[stat] += value
      return { type: 'stat', description: `${STAT_NAMES[stat]}+${value}`, statType: stat, statValue: value }
    }
    
    if (roll < 90) {
      const statTypes: StatType[] = ['critRate', 'critDamage', 'penetration', 'dodge', 'accuracy', 'critResist']
      if (!isStatUnlocked(statTypes[0])) {
        const basicStats: StatType[] = ['attack', 'defense', 'maxHp', 'speed']
        const stat = basicStats[Math.floor(Math.random() * basicStats.length)]
        const value = Math.floor((Math.random() * 5 + 1) * Math.min(phaseMultiplier, 100))
        player.value.stats[stat] += value
        return { type: 'stat', description: `${STAT_NAMES[stat]}+${value}`, statType: stat, statValue: value }
      }
      const stat = statTypes[Math.floor(Math.random() * statTypes.length)]
      if (!isStatUnlocked(stat)) {
        return doLottery()
      }
      // accuracy 必中概率需要除以10000
      const baseValue = Math.floor((Math.random() * 3 + 1) * Math.min(phaseMultiplier, 10))
      const value = stat === 'accuracy' ? baseValue / 10000 : baseValue
      player.value.stats[stat] += value
      const displayValue = stat === 'accuracy' ? (value * 100).toFixed(4) + '%' : value
      return { type: 'stat', description: `${STAT_NAMES[stat]}+${displayValue}`, statType: stat, statValue: value }
    }
    
    const goldAmount = Math.floor((Math.random() * 200 + 100) * phaseMultiplier)
    player.value.gold += goldAmount
    return { type: 'gold', description: `${goldAmount}金币`, goldAmount }
  }
  
  function doLottery10(): LotteryReward[] | null {
    const cost10 = getLottery10Cost()
    if (player.value.gold < cost10) return null
    
    player.value.gold -= cost10
    
    const rewards: LotteryReward[] = []
    for (let i = 0; i < 10; i++) {
      const reward = doLottery()
      if (reward) rewards.push(reward)
    }
    return rewards
  }
  
  function doLotteryUntilCant(): { totalRewards: LotteryReward[], totalSpent: number } {
    let totalSpent = 0
    const allRewards: LotteryReward[] = []
    const cost = getLotteryCost()
    
    while (player.value.gold >= cost) {
      const reward = doLottery()
      if (reward) {
        allRewards.push(reward)
        totalSpent += cost
      } else {
        break
      }
    }
    
    return { totalRewards: allRewards, totalSpent }
  }
  
  function takeDamage(damage: number): number {
    const actualDamage = Math.max(1, damage)
    player.value.currentHp = Math.max(0, player.value.currentHp - actualDamage)
    return actualDamage
  }
  
  function heal(amount: number) {
    player.value.currentHp = Math.min(player.value.maxHp, player.value.currentHp + amount)
  }
  
  function healPercent(percent: number) {
    const healAmount = calculateHealing(player.value, totalStats.value, percent)
    heal(healAmount)
  }
  
  function isDead(): boolean {
    return player.value.currentHp <= 0
  }
  
  function revive() {
    player.value.currentHp = player.value.maxHp
    saveGame()
  }
  
  function applyBuff(stat: StatType, value: number, durationSeconds: number) {
    activeBuffs.value.set(stat, {
      value,
      endTime: Date.now() + durationSeconds * 1000
    })
  }
  
  function getActiveBuffs(): { stat: StatType; value: number; remainingTime: number; totalDuration: number; percent: number }[] {
    const buffs: { stat: StatType; value: number; remainingTime: number; totalDuration: number; percent: number }[] = []
    const now = Date.now()
    
    try {
      for (const [stat, buff] of activeBuffs.value) {
        if (now < buff.endTime) {
          const remainingTime = (buff.endTime - now) / 1000
          const originalDuration = getBuffOriginalDuration(stat)
          const percent = originalDuration > 0 ? (remainingTime / originalDuration) * 100 : 0
          buffs.push({ stat, value: buff.value, remainingTime, totalDuration: originalDuration, percent })
        }
      }
    } catch (e) {
      return buffs
    }
    return buffs
  }
  
  function getBuffOriginalDuration(stat: StatType): number {
    const skills = player.value.skills
    if (!skills) return 5
    for (const skill of skills) {
      if (skill && skill.buffEffect && skill.buffEffect.stat === stat) {
        return skill.buffEffect.duration
      }
    }
    return 5
  }
  
  function learnSkill(skill: Skill, slotIndex: number): boolean {
    if (slotIndex < 0 || slotIndex >= player.value.skills.length) return false
    if (skill.unlockPhase > (player.value.unlockedPhases[player.value.unlockedPhases.length - 1] || 1)) return false
    
    player.value.skills[slotIndex] = createSkillInstance(skill)
    saveGame()
    return true
  }
  
function unlockSkillSlot(): boolean {
    if (player.value.skills.length >= 5) return false

    player.value.skills.push(null)
    saveGame()
    return true
  }
  
  function getAvailableSkills(): Skill[] {
    return getUnlockedSkills(player.value.unlockedPhases[player.value.unlockedPhases.length - 1] || 1)
  }
  
  function incrementKillCount() {
    player.value.totalKillCount++
  }
  
  function updateOnlineTime(seconds: number) {
    player.value.totalOnlineTime += seconds
  }
  
  function resetGame() {
    const monsterStore = useMonsterStore()
    player.value = createDefaultPlayer()
    monsterStore.initMonster()
    pendingOfflineReward.value = null
    activeBuffs.value.clear()
    saveGame()
  }
  
  function resetForRebirth() {
    const defaultPlayer = createDefaultPlayer()
    player.value = {
      ...defaultPlayer,
      gold: 0,
      diamond: 0,
      equipment: {},
      skills: [null, null, null, null, null],
      // 保留累计数据
      totalKillCount: player.value.totalKillCount,
      totalComboCount: player.value.totalComboCount,
      maxComboCount: player.value.maxComboCount,
      totalOnlineTime: player.value.totalOnlineTime,
      totalOfflineTime: player.value.totalOfflineTime,
      lastLoginTime: Date.now()
    }
    pendingOfflineReward.value = null
    activeBuffs.value.clear()
    saveGame()
  }
  
  return {
    player,
    totalStats,
    pendingOfflineReward,
    activeBuffs,
    statUpgradeCounts,
    pendingEquipment,
    loadGame,
    saveGame,
    claimOfflineReward,
    addGold,
    addDiamond,
    addStatReward,
    addExperience,
    checkLevelUp,
    getExpNeeded,
    getExpPerSecond,
    getExpPerKill,
    getAverageExpPerSecond,
    getSecondsToLevelUp,
    checkPhaseUnlock,
    isStatUnlocked,
    equipItem,
    autoEquipIfBetter,
    unequipItem,
    toggleEquipLock,
    upgradeStat,
    getUpgradeCost,
    getPointsForGold,
    canUpgradeStat,
    generateRandomEquipment,
    equipNewEquipment,
    getLotteryCost,
    getLottery10Cost,
    doLottery,
    doLottery10,
    doLotteryUntilCant,
    takeDamage,
    heal,
    healPercent,
    isDead,
    revive,
    applyBuff,
    getActiveBuffs,
    pruneExpiredBuffs,
    learnSkill,
    unlockSkillSlot,
    getAvailableSkills,
    incrementKillCount,
    updateOnlineTime,
    resetGame,
    resetForRebirth
  }
})
