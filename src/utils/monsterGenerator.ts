import type { Monster, ElementType } from '../types'
import { generateId, calculateCritRate, calculateCritDamage } from './calc'
import { SKILL_POOL } from './skillSystem'
import { createBossMechanicState, selectBossMechanic } from '../data/bossMechanics'

const MONSTER_NAMES = [
  '纸箱怪', '垃圾桶精', '塑料瓶妖', '易拉罐魔', '旧报纸灵',
  '汽车机器人', '摩天楼巨人', '桥梁守卫', '红绿灯精灵', '广告牌妖',
  '山峰巨人', '岛屿龟', '大陆龙', '海洋水怪', '沙漠蝎子',
  '陨石妖', '卫星精灵', '行星巨兽', '彗星魔', '小行星怪',
  '恒星熔岩怪', '彗星毁灭者', '行星带守护', '星际尘埃魔',
  '星系核巨兽', '黑洞吞噬者', '脉冲星脉冲怪', '星云凝聚体', '暗物质存在',
  '宇宙裂隙怪物', '多维空间生物', '虚空领主', '时空吞噬者', '维度侵蚀者'
]

const BOSS_NAMES = [
  '垃圾大王', '废品君主', '建筑总监', '城市守卫者',
  '大陆领主', '山川之王', '行星吞噬者', '恒星毁灭者',
  '星系审判者', '银河暴君', '宇宙执法官', '维度杀手',
  '虚空主宰', '终极存在'
]

const MONSTER_HP_MULTIPLIER = 8
const MONSTER_ATTACK_MULTIPLIER = 0.8
const MONSTER_BASE_DEFENSE = 5
const MONSTER_DEFENSE_GROWTH = 0.05
const MONSTER_BASE_SPEED = 8
const MONSTER_SPEED_GROWTH = 1.5
const MONSTER_BASE_ACCURACY = 5
const MONSTER_ACCURACY_GROWTH = 0.03
const MONSTER_DODGE_GROWTH = 0.03
const BOSS_HP_MULTIPLIER = 4
const BOSS_ATTACK_MULTIPLIER = 1.4
const BOSS_DEFENSE_MULTIPLIER = 1.2
const BOSS_CRIT_DAMAGE_MULTIPLIER = 1.4
const NORMAL_EQUIPMENT_DROP_CHANCE = 0.12
const BOSS_EQUIPMENT_DROP_CHANCE = 1

export function generateMonster(difficultyValue: number, level: number = 1, rng: () => number = Math.random): Monster {
  const isBoss = level % 10 === 0
  
  const baseValue = 10 * Math.pow(1.15, difficultyValue / 10)
  
  const hp = baseValue * MONSTER_HP_MULTIPLIER
  const attack = baseValue * MONSTER_ATTACK_MULTIPLIER
  const monsterDef = Math.floor(MONSTER_BASE_DEFENSE + difficultyValue * MONSTER_DEFENSE_GROWTH)
  const goldReward = Math.floor(baseValue * 2)
  const expReward = Math.max(1, Math.floor(difficultyValue * 0.5))
  
  // T18.3 暴击成长曲线
  const critRate = calculateCritRate(difficultyValue)
  const critDamage = calculateCritDamage(difficultyValue)
  const speed = MONSTER_BASE_SPEED + Math.pow(Math.max(1, difficultyValue), 0.5) * MONSTER_SPEED_GROWTH
  
  const baseCritResist = difficultyValue * 0.1
  const basePenetration = Math.floor(difficultyValue * 0.1)
  const baseAccuracy = MONSTER_BASE_ACCURACY + difficultyValue * MONSTER_ACCURACY_GROWTH
  const baseDodge = difficultyValue * MONSTER_DODGE_GROWTH
  
  const availableSkills = SKILL_POOL.filter(s => {
    const skillDifficulty = s.unlockPhase * 100
    return skillDifficulty <= difficultyValue
  })
  const skillCount = Math.min(Math.floor(difficultyValue / 200) + 1, 4)
  const skills: string[] = []
  
  for (let i = 0; i < skillCount && availableSkills.length > 0; i++) {
    const idx = Math.floor(rng() * availableSkills.length)
    const skill = availableSkills.splice(idx, 1)[0]
    if (skill) skills.push(skill.id)
  }
  
  const nameList = isBoss ? BOSS_NAMES : MONSTER_NAMES
  const baseName = nameList[Math.floor(rng() * nameList.length)]
  const name = isBoss ? `${baseName} [BOSS]` : `${baseName} Lv.${level}`
  const bossMechanic = isBoss ? selectBossMechanic(difficultyValue, level) : undefined
  const bossState = bossMechanic ? createBossMechanicState() : undefined
  const bossDefenseMultiplier = bossMechanic?.defenseMultiplier ?? 1
  const bossSpeedMultiplier = bossMechanic?.speedMultiplier ?? 1
  
  return {
    id: generateId(),
    name,
    level,
    phase: Math.min(7, Math.floor(difficultyValue / 500) + 1),
    maxHp: Math.floor(isBoss ? hp * BOSS_HP_MULTIPLIER : hp),
    currentHp: Math.floor(isBoss ? hp * BOSS_HP_MULTIPLIER : hp),
    attack: Math.floor(isBoss ? attack * BOSS_ATTACK_MULTIPLIER : attack),
    defense: Math.floor(isBoss ? monsterDef * BOSS_DEFENSE_MULTIPLIER * bossDefenseMultiplier : monsterDef),
    speed: Math.floor(speed * bossSpeedMultiplier),
    critRate,
    critDamage: Math.floor(isBoss ? critDamage * BOSS_CRIT_DAMAGE_MULTIPLIER : critDamage),
    critResist: Math.floor(baseCritResist),
    penetration: Math.floor(basePenetration),
    accuracy: Math.min(baseAccuracy + (bossMechanic?.accuracyBonus ?? 0), 100),
    dodge: Math.min(baseDodge + (bossMechanic?.dodgeBonus ?? 0), 70),
    goldReward: Math.floor(isBoss ? goldReward * 3 : goldReward),
    expReward: Math.floor(isBoss ? expReward * 3 : expReward),
    equipmentDropChance: isBoss ? BOSS_EQUIPMENT_DROP_CHANCE : NORMAL_EQUIPMENT_DROP_CHANCE,
    diamondDropChance: isBoss ? 0.5 : 0.01,
    isBoss,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills,
    // T21.1 初始化标记状态
    status: { marks: [], elemental: [] },
    // T65 元素属性
    element: generateMonsterElement(difficultyValue, isBoss, rng),
    bossMechanic,
    bossState
  }
}

/**
 * T65 为怪物生成元素属性
 * - 50%概率无属性
 * - 50%概率随机分配 fire/water/wind/dark（暗系更稀有，仅boss中可能出现）
 */
function generateMonsterElement(_difficultyValue: number, isBoss: boolean, rng: () => number = Math.random): ElementType {
  if (rng() > 0.5) return 'none'
  const rand = rng()
  if (isBoss && rand < 0.2) return 'dark' // 20%暗（仅boss）
  if (rand < 0.3) return 'fire'
  if (rand < 0.6) return 'water'
  return 'wind'
}

export function getNextMonsterLevel(_currentMonster: Monster, difficultyValue: number): number {
  return Math.floor(difficultyValue / 10) + 1
}

export function getPhaseProgress(difficultyValue: number): number {
  const progressInCycle = (difficultyValue % 500) / 500
  return Math.min(progressInCycle, 1)
}
