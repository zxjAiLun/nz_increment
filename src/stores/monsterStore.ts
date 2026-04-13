import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Monster, MarkType, MarkEffect } from '../types'
import { generateMonster, getNextMonsterLevel, getPhaseProgress } from '../utils/monsterGenerator'
import { getSkillById } from '../utils/skillSystem'

export const useMonsterStore = defineStore('monster', () => {
  const difficultyValue = ref(0)
  const currentMonster = ref<Monster | null>(null)
  const monsterLevel = ref(1)
  const monsterAction = ref<string | null>(null)
  const lastMonsterAction = ref<string | null>(null)
  
  const phaseProgress = computed(() => {
    return getPhaseProgress(difficultyValue.value)
  })
  
  const currentPhase = computed(() => {
    return Math.min(7, Math.floor(difficultyValue.value / 500) + 1)
  })
  
  const monsterHpPercent = computed(() => {
    if (!currentMonster.value) return 0
    return Math.max(0, (currentMonster.value.currentHp / currentMonster.value.maxHp) * 100)
  })
  
  const monsterSkills = computed(() => {
    if (!currentMonster.value) return []
    return currentMonster.value.skills.map(id => getSkillById(id)).filter(Boolean)
  })
  
  function initMonster() {
    currentMonster.value = generateMonster(difficultyValue.value, monsterLevel.value)
  }

  function setProgress(difficulty: number, level: number) {
    difficultyValue.value = difficulty
    monsterLevel.value = level
    currentMonster.value = generateMonster(difficulty, level)
  }
  
  function damageMonster(damage: number): { 
    killed: boolean
    newMonster: boolean
    goldReward: number
    expReward: number
    shouldDropEquipment: boolean
    diamondReward: number
  } {
    if (!currentMonster.value) {
      return { killed: false, newMonster: false, goldReward: 0, expReward: 0, shouldDropEquipment: false, diamondReward: 0 }
    }
    
    currentMonster.value.currentHp -= damage
    
    if (currentMonster.value.currentHp <= 0) {
      const goldReward = currentMonster.value.goldReward
      const expReward = currentMonster.value.expReward
      const diamondReward = Math.random() < currentMonster.value.diamondDropChance 
        ? Math.floor(1 + Math.random() * (currentMonster.value.isBoss ? 200 : 10))
        : 0
      const shouldDropEquipment = Math.random() < currentMonster.value.equipmentDropChance
      
      difficultyValue.value++
      
      const nextLevel = getNextMonsterLevel(currentMonster.value, difficultyValue.value)
      monsterLevel.value = nextLevel
      currentMonster.value = generateMonster(difficultyValue.value, nextLevel)
      
      return {
        killed: true,
        newMonster: true,
        goldReward,
        expReward,
        shouldDropEquipment,
        diamondReward
      }
    }
    
    return { killed: false, newMonster: false, goldReward: 0, expReward: 0, shouldDropEquipment: false, diamondReward: 0 }
  }
  
  function getMonsterHpPercent(): number {
    if (!currentMonster.value) return 0
    return Math.max(0, (currentMonster.value.currentHp / currentMonster.value.maxHp) * 100)
  }
  
  function performMonsterAction(): string | null {
    if (!currentMonster.value || currentMonster.value.skills.length === 0) {
      return null
    }
    
    const skillId = currentMonster.value.skills[Math.floor(Math.random() * currentMonster.value.skills.length)]
    const skill = getSkillById(skillId)
    
    if (skill) {
      lastMonsterAction.value = `${currentMonster.value.name} 使用了 ${skill.name}!`
      monsterAction.value = lastMonsterAction.value
      return skillId
    }
    return null
  }
  
  function clearMonsterAction() {
    monsterAction.value = null
  }
  
  function goBackLevels(levels: number = 10) {
    difficultyValue.value = Math.max(0, difficultyValue.value - levels)
    monsterLevel.value = Math.max(1, monsterLevel.value - levels)
    currentMonster.value = generateMonster(difficultyValue.value, monsterLevel.value)
  }
  
  function resetForRebirth() {
    // 转生后保留主线进度，只重置当前怪物
    currentMonster.value = generateMonster(difficultyValue.value, monsterLevel.value)
    monsterAction.value = null
    lastMonsterAction.value = null
  }

  // T21.3 标记系统函数
  function addMark(monster: Monster, mark: MarkEffect) {
    if (!monster.status) monster.status = { marks: [], elemental: [] }
    const existing = monster.status.marks.find(m => m.type === mark.type)
    if (existing) {
      existing.stacks = Math.min(existing.stacks + mark.stacks, 5)
      existing.duration = mark.duration
    } else {
      monster.status.marks.push({ ...mark })
    }
  }

  function consumeMark(monster: Monster, markType: MarkType): number {
    if (!monster.status) return 0
    const mark = monster.status.marks.find(m => m.type === markType)
    if (!mark) return 0
    const stacks = mark.stacks
    monster.status.marks = monster.status.marks.filter(m => m.type !== markType)
    return stacks
  }

  function tickMarks(monster: Monster) {
    if (!monster.status) return
    for (const mark of monster.status.marks) {
      mark.duration--
    }
    monster.status.marks = monster.status.marks.filter(m => m.duration > 0)
  }

  return {
    difficultyValue,
    currentMonster,
    monsterLevel,
    monsterAction,
    lastMonsterAction,
    currentPhase,
    phaseProgress,
    monsterHpPercent,
    monsterSkills,
    initMonster,
    setProgress,
    damageMonster,
    getMonsterHpPercent,
    performMonsterAction,
    clearMonsterAction,
    goBackLevels,
    resetForRebirth,
    // T21.3 标记系统
    addMark,
    consumeMark,
    tickMarks
  }
})
