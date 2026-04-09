import type { Monster } from '../types'
import { generateId, calculateCritRate, calculateCritDamage } from './calc'
import { SKILL_POOL } from './skillSystem'

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

export function generateMonster(difficultyValue: number, level: number = 1): Monster {
  const isBoss = level % 10 === 0
  
  const baseValue = 10 * Math.pow(1.15, difficultyValue / 10)
  
  const hp = baseValue * 100
  const attack = baseValue * 10
  // T18.4 防御线性成长（替代原来的指数成长）
  const baseDef = 20
  const monsterDef = Math.floor(baseDef * (1 + difficultyValue * 0.02))
  const goldReward = Math.floor(baseValue * 2)
  const expReward = Math.floor(difficultyValue * 0.5)
  
  // T18.3 暴击成长曲线
  const critRate = calculateCritRate(difficultyValue)
  const critDamage = calculateCritDamage(difficultyValue)
  const speed = 10 + Math.pow(Math.max(1, difficultyValue), 0.5) * 2
  
  const baseCritResist = difficultyValue * 0.1
  const basePenetration = difficultyValue * 0.05
  const baseAccuracy = 20 + difficultyValue * 0.05
  const baseDodge = difficultyValue * 0.05
  
  const availableSkills = SKILL_POOL.filter(s => {
    const skillDifficulty = s.unlockPhase * 100
    return skillDifficulty <= difficultyValue
  })
  const skillCount = Math.min(Math.floor(difficultyValue / 200) + 1, 4)
  const skills: string[] = []
  
  for (let i = 0; i < skillCount && availableSkills.length > 0; i++) {
    const idx = Math.floor(Math.random() * availableSkills.length)
    const skill = availableSkills.splice(idx, 1)[0]
    if (skill) skills.push(skill.id)
  }
  
  const nameList = isBoss ? BOSS_NAMES : MONSTER_NAMES
  const baseName = nameList[Math.floor(Math.random() * nameList.length)]
  const name = isBoss ? `${baseName} [BOSS]` : `${baseName} Lv.${level}`
  
  return {
    id: generateId(),
    name,
    level,
    phase: Math.min(7, Math.floor(difficultyValue / 500) + 1),
    maxHp: Math.floor(isBoss ? hp * 5 : hp),
    currentHp: Math.floor(isBoss ? hp * 5 : hp),
    attack: Math.floor(isBoss ? attack * 1.5 : attack),
    defense: Math.floor(isBoss ? monsterDef * 1.2 : monsterDef),
    speed: Math.floor(speed),
    critRate,
    critDamage: Math.floor(isBoss ? critDamage * 1.5 : critDamage),
    critResist: Math.floor(baseCritResist),
    penetration: Math.floor(basePenetration),
    accuracy: Math.min(baseAccuracy, 100),
    dodge: Math.min(baseDodge, 50),
    goldReward: Math.floor(isBoss ? goldReward * 3 : goldReward),
    expReward: Math.floor(isBoss ? expReward * 3 : expReward),
    equipmentDropChance: 0.3,
    diamondDropChance: isBoss ? 0.5 : 0.01,
    isBoss,
    isTrainingMode: false,
    trainingDifficulty: null,
    skills
  }
}

export function getNextMonsterLevel(currentMonster: Monster, difficultyValue: number): number {
  return Math.floor(difficultyValue / 10) + 1
}

export function getPhaseProgress(difficultyValue: number): number {
  const progressInCycle = (difficultyValue % 500) / 500
  return Math.min(progressInCycle, 1)
}
