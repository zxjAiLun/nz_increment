import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Monster } from '../types'
import { generateId } from '../utils/calc'

export type TrainingDifficulty = 'easy' | 'medium' | 'hard'

export const useTrainingStore = defineStore('training', () => {
  const trainingLevel = ref(1)
  const trainingDifficulty = ref<TrainingDifficulty>('medium')
  const currentTrainingMonster = ref<Monster | null>(null)
  const trainingKillCount = ref(0)

  // 自动难度提升相关
  const lastKillTime = ref(0) // 上次击杀时间戳
  const consecutiveFastKills = ref(0) // 连续快速击杀计数
  const autoUpgradeEnabled = ref(true) // 自动难度提升开关
  const fastKillThresholdMs = ref(1000) // 快速击杀阈值（毫秒）
  const consecutiveKillsRequired = ref(5) // 触发自动升级所需的连续快速击杀数
  const showAutoUpgradeNotice = ref(false) // 显示自动升级提示
  const autoUpgradeTimer = ref<number | null>(null)

  // 金币获取统计
  const totalGoldEarned = ref(0) // 累计获得金币
  const totalExpEarned = ref(0) // 累计获得经验
  const trainingStartTime = ref(Date.now()) // 练功房开始时间

  // 属性掉落统计
  const statDropTypes = ['attack', 'defense', 'maxHp', 'speed'] as const
  const lastStatDrop = ref<{ type: string, value: number } | null>(null)

  const difficultyMultipliers: Record<TrainingDifficulty, number> = {
    easy: 0.5,
    medium: 1,
    hard: 2
  }
  
  const TRAINING_NAMES: Record<TrainingDifficulty, string[]> = {
    easy: ['练功假人', '训练木桩', '练习沙包'],
    medium: ['练功战士', '训练骑士', '练习武者'],
    hard: ['练功大师', '训练宗师', '练习巅峰']
  }
  
  function getDifficultyValue(): number {
    return trainingLevel.value * 10
  }
  
  function generateTrainingMonster(): Monster {
    const difficulty = getDifficultyValue()
    const m = difficultyMultipliers[trainingDifficulty.value]
    
    const baseValue = 10 * Math.pow(1.15, difficulty / 10)
    
    const hp = baseValue * 100 * m
    const attack = baseValue * 10 * m
    const defense = baseValue * 5 * m
    const goldReward = Math.floor(baseValue * 2 * m)
    const expReward = Math.floor(difficulty * 0.5 * m)
    
    const critRate = Math.min(5 + difficulty * 0.01, 50)
    const critDamage = Math.min(150 + difficulty * 0.1, 300)
    const speed = 10 + difficulty * 0.005
    
    const names = TRAINING_NAMES[trainingDifficulty.value]
    const name = names[Math.floor(Math.random() * names.length)]
    
    return {
      id: generateId(),
      name: `${name} [练功房Lv.${trainingLevel.value}]`,
      level: trainingLevel.value,
      phase: 1,
      maxHp: Math.floor(hp),
      currentHp: Math.floor(hp),
      attack: Math.floor(attack),
      defense: Math.floor(defense),
      speed: Math.floor(speed),
      critRate: Math.min(critRate, 80),
      critDamage: Math.floor(critDamage),
      critResist: Math.floor(difficulty * 0.1),
      penetration: Math.floor(difficulty * 0.05),
      accuracy: Math.min(20 + difficulty * 0.05, 100),
      dodge: Math.min(difficulty * 0.05, 50),
      goldReward,
      expReward,
      equipmentDropChance: 0.3,
      diamondDropChance: 0.05,
      isBoss: false,
      isTrainingMode: true,
      trainingDifficulty: trainingDifficulty.value,
      skills: []
    }
  }
  
  function spawnTrainingMonster() {
    currentTrainingMonster.value = generateTrainingMonster()
    // 重置连续击杀计数，因为生成了新怪物
    consecutiveFastKills.value = 0
  }
  
  function damageTrainingMonster(playerAttack: number): {
    killed: boolean
    goldReward: number
    expReward: number
    diamondReward: number
    shouldDropEquipment: boolean
    autoUpgraded: boolean
    statDrop: { type: string, value: number } | null
  } {
    if (!currentTrainingMonster.value) {
      return { killed: false, goldReward: 0, expReward: 0, diamondReward: 0, shouldDropEquipment: false, autoUpgraded: false, statDrop: null }
    }

    const monster = currentTrainingMonster.value
    const effectiveDefense = Math.max(0, monster.defense)
    const damageReduction = effectiveDefense / (effectiveDefense + 200)
    const actualDamage = Math.max(1, Math.floor(playerAttack * (1 - damageReduction)))

    monster.currentHp -= actualDamage

    if (currentTrainingMonster.value.currentHp <= 0) {
      const monster = currentTrainingMonster.value
      const goldReward = monster.goldReward
      const expReward = monster.expReward
      const diamondReward = Math.random() < monster.diamondDropChance ? Math.floor(trainingLevel.value * 0.5) : 0
      const shouldDropEquipment = Math.random() < monster.equipmentDropChance

      // 属性掉落 - 30%几率，掉落量很小
      let statDrop: { type: string, value: number } | null = null
      if (Math.random() < 0.3) {
        const statType = statDropTypes[Math.floor(Math.random() * statDropTypes.length)]
        const statValue = Math.max(1, Math.floor(trainingLevel.value * 0.1)) // 每级约0.1点
        statDrop = { type: statType, value: statValue }
        lastStatDrop.value = statDrop
        totalGoldEarned.value += goldReward
        totalExpEarned.value += expReward
      }

      trainingKillCount.value++

      // 自动难度提升检测
      let autoUpgraded = false
      if (autoUpgradeEnabled.value) {
        const now = Date.now()
        if (lastKillTime.value > 0 && (now - lastKillTime.value) < fastKillThresholdMs.value) {
          // 这次也是快速击杀
          consecutiveFastKills.value++
          if (consecutiveFastKills.value >= consecutiveKillsRequired.value) {
            // 连续快速击杀达到阈值，自动升级
            upgradeTrainingLevel()
            consecutiveFastKills.value = 0
            autoUpgraded = true
          }
        } else {
          // 不是快速击杀，重置计数
          consecutiveFastKills.value = 1
        }
        lastKillTime.value = now
      }

      currentTrainingMonster.value = null

      return { killed: true, goldReward, expReward, diamondReward, shouldDropEquipment, autoUpgraded, statDrop }
    }

    return { killed: false, goldReward: 0, expReward: 0, diamondReward: 0, shouldDropEquipment: false, autoUpgraded: false, statDrop: null }
  }
  
  function upgradeTrainingLevel() {
    trainingLevel.value++
    spawnTrainingMonster()
    // 显示自动升级通知
    showAutoUpgradeNotice.value = true
    if (autoUpgradeTimer.value) {
      clearTimeout(autoUpgradeTimer.value)
    }
    autoUpgradeTimer.value = window.setTimeout(() => {
      showAutoUpgradeNotice.value = false
    }, 2000)
  }
  
  function downgradeTrainingLevel() {
    if (trainingLevel.value > 1) {
      trainingLevel.value--
      spawnTrainingMonster()
    }
  }
  
  function setDifficulty(difficulty: TrainingDifficulty) {
    trainingDifficulty.value = difficulty
    spawnTrainingMonster()
  }
  
  function resetTraining() {
    trainingLevel.value = 1
    trainingDifficulty.value = 'medium'
    currentTrainingMonster.value = null
    trainingKillCount.value = 0
  }
  
  function getExpectedGoldReward(): number {
    const difficulty = getDifficultyValue()
    const m = difficultyMultipliers[trainingDifficulty.value]
    const baseValue = 10 * Math.pow(1.15, difficulty / 10)
    return Math.floor(baseValue * 2 * m)
  }
  
  function getExpectedExpReward(): number {
    const difficulty = getDifficultyValue()
    const m = difficultyMultipliers[trainingDifficulty.value]
    return Math.floor(difficulty * 0.5 * m)
  }

  // 计算金币获取速率（每小时）
  function getGoldPerHour(): number {
    const elapsedMs = Date.now() - trainingStartTime.value
    const elapsedHours = elapsedMs / (1000 * 60 * 60)
    if (elapsedHours < 0.01) return 0
    return Math.floor(totalGoldEarned.value / elapsedHours)
  }

  // 计算经验获取速率（每小时）
  function getExpPerHour(): number {
    const elapsedMs = Date.now() - trainingStartTime.value
    const elapsedHours = elapsedMs / (1000 * 60 * 60)
    if (elapsedHours < 0.01) return 0
    return Math.floor(totalExpEarned.value / elapsedHours)
  }

  // 重置练功房统计
  function resetTrainingStats() {
    totalGoldEarned.value = 0
    totalExpEarned.value = 0
    trainingStartTime.value = Date.now()
  }

  return {
    trainingLevel,
    trainingDifficulty,
    currentTrainingMonster,
    trainingKillCount,
    autoUpgradeEnabled,
    fastKillThresholdMs,
    consecutiveKillsRequired,
    consecutiveFastKills,
    showAutoUpgradeNotice,
    totalGoldEarned,
    totalExpEarned,
    lastStatDrop,
    difficultyMultipliers,
    generateTrainingMonster,
    spawnTrainingMonster,
    damageTrainingMonster,
    upgradeTrainingLevel,
    downgradeTrainingLevel,
    setDifficulty,
    resetTraining,
    getExpectedGoldReward,
    getExpectedExpReward,
    getGoldPerHour,
    getExpPerHour,
    resetTrainingStats
  }
})
