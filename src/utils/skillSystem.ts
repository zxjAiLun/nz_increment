import type { Skill } from '../types'
import { generateId } from './calc'

export const SKILL_POOL: Skill[] = [
  {
    id: 'skill_heavy_strike',
    name: '重击',
    description: '造成3倍攻击力伤害，无视50%防御',
    type: 'damage',
    damageMultiplier: 3,
    ignoreDefense: false,
    defenseIgnorePercent: 50,
    trueDamage: 0,
    cooldown: 3,
    currentCooldown: 0,
    unlockPhase: 1,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_defense_stance',
    name: '防御姿态',
    description: '提升30%防御，持续5秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 10,
    currentCooldown: 0,
    unlockPhase: 1,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'defense',
      percentBoost: 30,
      duration: 5
    }
  },
  {
    id: 'skill_double_strike',
    name: '连刺',
    description: '造成2倍攻击力伤害，触发两次',
    type: 'damage',
    damageMultiplier: 2,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 4,
    currentCooldown: 0,
    unlockPhase: 2,
    hitCount: 2,
    healPercent: 0
  },
  {
    id: 'skill_blood_rage',
    name: '血性狂暴',
    description: '攻击力+50%，持续5秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 15,
    currentCooldown: 0,
    unlockPhase: 3,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'attack',
      percentBoost: 50,
      duration: 5
    }
  },
  {
    id: 'skill_armor_pierce',
    name: '穿甲打击',
    description: '造成5倍攻击力伤害，无视100%防御',
    type: 'damage',
    damageMultiplier: 5,
    ignoreDefense: true,
    defenseIgnorePercent: 100,
    trueDamage: 0,
    cooldown: 5,
    currentCooldown: 0,
    unlockPhase: 4,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_thunder_strike',
    name: '雷霆一击',
    description: '造成4倍攻击力+200真实伤害',
    type: 'damage',
    damageMultiplier: 4,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 200,
    cooldown: 8,
    currentCooldown: 0,
    unlockPhase: 5,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_gravity_crush',
    name: '重力碾压',
    description: '造成10倍攻击力+500真实伤害',
    type: 'damage',
    damageMultiplier: 10,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 500,
    cooldown: 12,
    currentCooldown: 0,
    unlockPhase: 6,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_dimension_slash',
    name: '维度斩击',
    description: '造成20倍攻击力伤害，无视一切防御',
    type: 'damage',
    damageMultiplier: 20,
    ignoreDefense: true,
    defenseIgnorePercent: 100,
    trueDamage: 1000,
    cooldown: 15,
    currentCooldown: 0,
    unlockPhase: 7,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_heal',
    name: '生命恢复',
    description: '恢复30%最大生命值',
    type: 'heal',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 20,
    currentCooldown: 0,
    unlockPhase: 2,
    hitCount: 1,
    healPercent: 30
  },
  {
    id: 'skill_voidbolt',
    name: '虚空之箭',
    description: '造成3倍攻击力+100真实伤害，无视防御',
    type: 'damage',
    damageMultiplier: 3,
    ignoreDefense: true,
    defenseIgnorePercent: 100,
    trueDamage: 100,
    cooldown: 6,
    currentCooldown: 0,
    unlockPhase: 5,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_whirlwind',
    name: '旋风斩',
    description: '造成1.5倍攻击力伤害，触发4次',
    type: 'damage',
    damageMultiplier: 1.5,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 6,
    currentCooldown: 0,
    unlockPhase: 2,
    hitCount: 4,
    healPercent: 0
  },
  {
    id: 'skill_energy_shield',
    name: '能量护盾',
    description: '生成护盾，吸收200%攻击力的伤害，持续8秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 15,
    currentCooldown: 0,
    unlockPhase: 3,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'defense',
      percentBoost: 100,
      duration: 8
    }
  },
  {
    id: 'skill_critical_boost',
    name: '暴击强化',
    description: '暴击率+30%，暴击伤害+50%，持续6秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 12,
    currentCooldown: 0,
    unlockPhase: 4,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'critRate',
      percentBoost: 30,
      duration: 6
    }
  },
  {
    id: 'skill_life_steal',
    name: '生命汲取',
    description: '造成3倍攻击力伤害，并恢复造成伤害的30%',
    type: 'damage',
    damageMultiplier: 3,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 8,
    currentCooldown: 0,
    unlockPhase: 4,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_meteor_strike',
    name: '流星陨落',
    description: '造成8倍攻击力+800真实伤害',
    type: 'damage',
    damageMultiplier: 8,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 800,
    cooldown: 10,
    currentCooldown: 0,
    unlockPhase: 6,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_speed_boost',
    name: '疾风步',
    description: '速度+100%，行动槽填充速度翻倍，持续5秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 15,
    currentCooldown: 0,
    unlockPhase: 3,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'speed',
      percentBoost: 100,
      duration: 5
    }
  },
  {
    id: 'skill_berserk',
    name: '狂战士',
    description: '攻击力+80%，但受到的伤害+30%，持续10秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 25,
    currentCooldown: 0,
    unlockPhase: 5,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'attack',
      percentBoost: 80,
      duration: 10
    }
  },
  {
    id: 'skill_time_stop',
    name: '时间静止',
    description: '造成15倍攻击力伤害，敌人行动槽暂停3秒',
    type: 'damage',
    damageMultiplier: 15,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 500,
    cooldown: 20,
    currentCooldown: 0,
    unlockPhase: 7,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_ultimate_power',
    name: '终极力量',
    description: '全属性+50%，持续15秒',
    type: 'buff',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 30,
    currentCooldown: 0,
    unlockPhase: 7,
    hitCount: 1,
    healPercent: 0,
    buffEffect: {
      stat: 'attack',
      percentBoost: 50,
      duration: 15
    }
  },
  {
    id: 'skill_frost_nova',
    name: '冰霜新星',
    description: '造成2倍攻击力伤害，敌人速度降低50%，持续4秒',
    type: 'damage',
    damageMultiplier: 2,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 10,
    currentCooldown: 0,
    unlockPhase: 5,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_chain_lightning',
    name: '连锁闪电',
    description: '造成4倍攻击力伤害，弹射3个敌人',
    type: 'damage',
    damageMultiplier: 4,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 150,
    cooldown: 7,
    currentCooldown: 0,
    unlockPhase: 5,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_divine_blessing',
    name: '神圣祝福',
    description: '恢复50%最大生命值，移除负面状态',
    type: 'heal',
    damageMultiplier: 0,
    ignoreDefense: false,
    defenseIgnorePercent: 0,
    trueDamage: 0,
    cooldown: 30,
    currentCooldown: 0,
    unlockPhase: 6,
    hitCount: 1,
    healPercent: 50
  },
  {
    id: 'skill_piercing_arrow',
    name: '贯穿之箭',
    description: '造成6倍攻击力伤害，无视100%防御，触发2次',
    type: 'damage',
    damageMultiplier: 6,
    ignoreDefense: true,
    defenseIgnorePercent: 100,
    trueDamage: 0,
    cooldown: 8,
    currentCooldown: 0,
    unlockPhase: 4,
    hitCount: 2,
    healPercent: 0
  },
  {
    id: 'skill_throw_stone',
    name: '投掷石块',
    description: '造成2倍攻击力伤害，无视30%防御',
    type: 'damage',
    damageMultiplier: 2,
    ignoreDefense: false,
    defenseIgnorePercent: 30,
    trueDamage: 0,
    cooldown: 2,
    currentCooldown: 0,
    unlockPhase: 1,
    hitCount: 1,
    healPercent: 0
  },
  {
    id: 'skill_power_strike',
    name: '蓄力重击',
    description: '造成5倍攻击力伤害，无视50%防御',
    type: 'damage',
    damageMultiplier: 5,
    ignoreDefense: false,
    defenseIgnorePercent: 50,
    trueDamage: 0,
    cooldown: 5,
    currentCooldown: 0,
    unlockPhase: 3,
    hitCount: 1,
    healPercent: 0
  }
]

export function getSkillById(id: string): Skill | undefined {
  return SKILL_POOL.find(s => s.id === id)
}

export function getSkillsForPhase(phase: number): Skill[] {
  return SKILL_POOL.filter(s => s.unlockPhase <= phase)
}

export function createSkillInstance(skill: Skill): Skill {
  return {
    ...skill,
    id: generateId(),
    currentCooldown: 0
  }
}

export function getUnlockedSkills(playerPhase: number): Skill[] {
  return SKILL_POOL.filter(s => s.unlockPhase <= playerPhase)
}
