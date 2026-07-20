import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Monster, MarkType, MarkEffect } from '../types'
import { generateMonster, getNextMonsterLevel, getPhaseProgress } from '../utils/monsterGenerator'
import { getSkillById } from '../utils/skillSystem'
import { applyDamageToMonster } from '../systems/combat/damage'

export const useMonsterStore = defineStore('monster', () => {
  const difficultyValue = ref(0)
  const currentMonster = ref<Monster | null>(null)
  const monsterLevel = ref(1)
  const monsterAction = ref<string | null>(null)
  const lastMonsterAction = ref<string | null>(null)
  // 遭遇（encounter）唯一令牌：每次 currentMonster 被（重新）指派都自增。
  // 运行时用它判断「一次战斗窗口内是否换怪」，从而停止旧遭遇的剩余事件、避免旧怪物时间窗口攻击新怪（A2.2）。
  const currentEncounterId = ref(0)
  
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
  
  // 统一入口：指派新怪物并自增 encounter 令牌（任何换怪点都必须走这里）。
  function assignMonster(monster: Monster) {
    currentMonster.value = monster
    currentEncounterId.value++
  }

  function initMonster() {
    assignMonster(generateMonster(difficultyValue.value, monsterLevel.value))
  }

  function setProgress(difficulty: number, level: number) {
    difficultyValue.value = difficulty
    monsterLevel.value = level
    assignMonster(generateMonster(difficulty, level))
  }
  
  function damageMonster(damage: number, rng: () => number = Math.random): {
    killed: boolean
    newMonster: boolean
    goldReward: number
    expReward: number
    baseEquipmentDropChance: number
    baseDiamondDropChance: number
    isBoss: boolean
    shieldDamage: number
    hpDamage: number
    appliedDamage: number
    healed: number
  } {
    if (!currentMonster.value) {
      return { killed: false, newMonster: false, goldReward: 0, expReward: 0, baseEquipmentDropChance: 0, baseDiamondDropChance: 0, isBoss: false, shieldDamage: 0, healed: 0, hpDamage: 0, appliedDamage: 0 }
    }

    const dmgResult = applyDamageToMonster({ monster: currentMonster.value, damage })
    const shieldDamage = dmgResult.shieldDamage
    const healed = dmgResult.healed
    const hpDamage = dmgResult.hpDamage
    const appliedDamage = dmgResult.appliedDamage

    if (dmgResult.killed) {
      // Phase 3.1：damageMonster 不再私自按怪物基础概率完成掉落。
      // 仅返回「被击杀旧怪」的基础奖励快照（掉率 / Boss 标记 / 金币 / 经验），
      // 由 gameStore 调用统一的 calculateKillDropChances + rollKillDrops 完成 roll，
      // 保证换怪后仍使用旧目标的掉率与 Boss 标记。
      const goldReward = currentMonster.value.goldReward
      const expReward = currentMonster.value.expReward
      const baseEquipmentDropChance = currentMonster.value.equipmentDropChance
      const baseDiamondDropChance = currentMonster.value.diamondDropChance
      const isBoss = currentMonster.value.isBoss

      difficultyValue.value++

      const nextLevel = getNextMonsterLevel(currentMonster.value, difficultyValue.value)
      monsterLevel.value = nextLevel
      assignMonster(generateMonster(difficultyValue.value, nextLevel, rng))

      return {
        killed: true,
        newMonster: true,
        goldReward,
        expReward,
        baseEquipmentDropChance,
        baseDiamondDropChance,
        isBoss,
        shieldDamage,
        hpDamage,
        appliedDamage,
        healed
      }
    }

    return { killed: false, newMonster: false, goldReward: 0, expReward: 0, baseEquipmentDropChance: 0, baseDiamondDropChance: 0, isBoss: false, shieldDamage, hpDamage, appliedDamage, healed }
  }
  
  function getMonsterHpPercent(): number {
    if (!currentMonster.value) return 0
    return Math.max(0, (currentMonster.value.currentHp / currentMonster.value.maxHp) * 100)
  }
  
  function performMonsterAction(rng: () => number = Math.random): string | null {
    if (!currentMonster.value || currentMonster.value.skills.length === 0) {
      return null
    }
    
    const skillId = currentMonster.value.skills[Math.floor(rng() * currentMonster.value.skills.length)]
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
    assignMonster(generateMonster(difficultyValue.value, monsterLevel.value))
  }
  
  function resetForRebirth() {
    // 转生后保留主线进度，只重置当前怪物
    assignMonster(generateMonster(difficultyValue.value, monsterLevel.value))
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
    currentEncounterId,
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
