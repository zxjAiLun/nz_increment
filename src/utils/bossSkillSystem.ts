export interface BossSkill {
  id: string
  name: string
  description: string
  damageMultiplier: number
  trueDamage: number
  cooldown: number
  effect?: BossSkillEffect
}

export interface BossSkillEffect {
  type: 'stun' | 'slow' | 'debuff' | 'shield' | 'heal'
  value: number
  duration: number
}

export const BOSS_SKILL_POOL: BossSkill[] = [
  {
    id: 'boss_heavy_strike',
    name: '重击',
    description: '造成2倍攻击力伤害',
    damageMultiplier: 2,
    trueDamage: 0,
    cooldown: 5
  },
  {
    id: 'boss_power_strike',
    name: '强力打击',
    description: '造成3倍攻击力伤害',
    damageMultiplier: 3,
    trueDamage: 0,
    cooldown: 8
  },
  {
    id: 'boss_critical_blade',
    name: '暴击之刃',
    description: '造成4倍攻击力伤害',
    damageMultiplier: 4,
    trueDamage: 0,
    cooldown: 10
  },
  {
    id: 'boss_devastating_blow',
    name: '毁灭打击',
    description: '造成5倍攻击力+500真实伤害',
    damageMultiplier: 5,
    trueDamage: 500,
    cooldown: 15
  },
  {
    id: 'boss_world_ender',
    name: '世界终结者',
    description: '造成10倍攻击力+2000真实伤害',
    damageMultiplier: 10,
    trueDamage: 2000,
    cooldown: 25
  },
  {
    id: 'boss_stun_strike',
    name: '眩晕打击',
    description: '造成2倍伤害并眩晕玩家2秒',
    damageMultiplier: 2,
    trueDamage: 0,
    cooldown: 12,
    effect: {
      type: 'stun',
      value: 2,
      duration: 2
    }
  },
  {
    id: 'boss_slow_attack',
    name: '迟缓打击',
    description: '造成2倍伤害并降低玩家速度50%，持续5秒',
    damageMultiplier: 2,
    trueDamage: 0,
    cooldown: 10,
    effect: {
      type: 'slow',
      value: 50,
      duration: 5
    }
  },
  {
    id: 'boss_life_drain',
    name: '生命汲取',
    description: '造成3倍伤害并恢复自身30%最大生命',
    damageMultiplier: 3,
    trueDamage: 0,
    cooldown: 15,
    effect: {
      type: 'heal',
      value: 30,
      duration: 0
    }
  },
  {
    id: 'boss_shield_bash',
    name: '护盾冲击',
    description: '造成3倍伤害并生成护盾',
    damageMultiplier: 3,
    trueDamage: 0,
    cooldown: 12,
    effect: {
      type: 'shield',
      value: 50,
      duration: 3
    }
  },
  {
    id: 'boss_curse_strike',
    name: '诅咒打击',
    description: '造成4倍伤害并减少玩家防御50%，持续5秒',
    damageMultiplier: 4,
    trueDamage: 0,
    cooldown: 15,
    effect: {
      type: 'debuff',
      value: 50,
      duration: 5
    }
  },
  {
    id: 'boss_apocalypse',
    name: '天启',
    description: '造成20倍攻击力+10000真实伤害',
    damageMultiplier: 20,
    trueDamage: 10000,
    cooldown: 45
  },
  {
    id: 'boss_void_blast',
    name: '虚空冲击',
    description: '造成15倍攻击力+5000真实伤害，无视防御',
    damageMultiplier: 15,
    trueDamage: 5000,
    cooldown: 30
  }
]

export function getBossSkillsForPhase(phase: number): BossSkill[] {
  const skills: BossSkill[] = []
  
  const phaseIndex = Math.min(phase - 1, BOSS_SKILL_POOL.length)
  
  if (phase >= 1) {
    skills.push(BOSS_SKILL_POOL[0])
    skills.push(BOSS_SKILL_POOL[1])
  }
  if (phase >= 2) {
    skills.push(BOSS_SKILL_POOL[2])
    skills.push(BOSS_SKILL_POOL[3])
  }
  if (phase >= 3) {
    skills.push(BOSS_SKILL_POOL[4])
    skills.push(BOSS_SKILL_POOL[5])
    skills.push(BOSS_SKILL_POOL[6])
  }
  if (phase >= 4) {
    skills.push(BOSS_SKILL_POOL[7])
    skills.push(BOSS_SKILL_POOL[8])
    skills.push(BOSS_SKILL_POOL[9])
  }
  if (phase >= 5) {
    skills.push(BOSS_SKILL_POOL[10])
    skills.push(BOSS_SKILL_POOL[11])
  }
  
  return skills
}

export function getBossSkillById(id: string): BossSkill | undefined {
  return BOSS_SKILL_POOL.find(skill => skill.id === id)
}

export function getRandomBossSkill(phase: number): BossSkill {
  const availableSkills = getBossSkillsForPhase(phase)
  return availableSkills[Math.floor(Math.random() * availableSkills.length)]
}

export function calculateBossSkillDamage(
  skill: BossSkill, 
  monsterAttack: number,
  monsterDefense: number,
  playerDefense: number
): { physicalDamage: number; trueDamage: number; totalDamage: number } {
  const baseDamage = monsterAttack * skill.damageMultiplier
  const physicalDamage = Math.max(1, baseDamage - playerDefense * 0.5)
  const trueDamage = skill.trueDamage
  const totalDamage = physicalDamage + trueDamage
  
  return {
    physicalDamage: Math.floor(physicalDamage),
    trueDamage: Math.floor(trueDamage),
    totalDamage: Math.floor(totalDamage)
  }
}
