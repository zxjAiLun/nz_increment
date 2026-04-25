import type { PlayerStats, StatType } from '../types'

export type BuildArchetypeId = 'critBurst' | 'lifestealTank' | 'armorTrueDamage' | 'speedSkill' | 'luckTreasure'

export interface BuildArchetype {
  id: BuildArchetypeId
  name: string
  shortName: string
  coreStats: StatType[]
  content: string
  feedback: string
  question: string
  summary: string
  representativeAffixes: StatType[]
  representativeSets: string[]
  representativeSkills: string[]
  countersBoss: string[]
  weakAgainstBoss: string[]
  uiTags: string[]
  tradeoff: string
  weights: Partial<Record<StatType, number>>
}

export interface BuildArchetypeScore {
  archetype: BuildArchetype
  score: number
  percent: number
  matchedStats: Array<{ stat: StatType; contribution: number }>
}

const STAT_SCALE: Partial<Record<StatType, number>> = {
  attack: 100,
  maxHp: 1000,
  defense: 100,
  critRate: 50,
  critDamage: 200,
  penetration: 100,
  trueDamage: 100,
  voidDamage: 100,
  speed: 100,
  skillDamageBonus: 100,
  cooldownReduction: 50,
  lifesteal: 15,
  luck: 100,
  damageBonusI: 100,
  damageBonusII: 100,
  damageBonusIII: 100
}

export const BUILD_ARCHETYPES: BuildArchetype[] = [
  {
    id: 'critBurst',
    name: '暴击爆发流',
    shortName: '暴击流',
    coreStats: ['critRate', 'critDamage', 'attack'],
    content: '普通推图、低甲 Boss',
    feedback: '大数字、连击',
    question: '我是不是在追求更高暴击数字？',
    summary: '用攻击打底，用暴击率稳定触发，用暴伤放大单次输出。',
    representativeAffixes: ['critRate', 'critDamage', 'attack', 'damageBonusI'],
    representativeSets: ['tyrant', 'warrior'],
    representativeSkills: ['skill_critical_boost', 'skill_blood_rage', 'skill_meteor_strike'],
    countersBoss: ['enrage', 'lifesteal'],
    weakAgainstBoss: ['highArmor', 'shield'],
    uiTags: ['大数字', '短时爆发', '低甲Boss'],
    tradeoff: '爆发高但续航较弱，遇到高护甲或护盾 Boss 需要换破甲/多段方案。',
    weights: { critRate: 1.4, critDamage: 1.2, attack: 1.0, combo: 0.5, damageBonusI: 0.4 }
  },
  {
    id: 'lifestealTank',
    name: '吸血坦克流',
    shortName: '吸血坦',
    coreStats: ['maxHp', 'defense', 'lifesteal'],
    content: '长时间 Boss、挂机',
    feedback: '血量拉回',
    question: '我是不是靠站得住和吸回来取胜？',
    summary: '堆生命和防御延长战斗窗口，再用吸血把压力转成续航。',
    representativeAffixes: ['maxHp', 'defense', 'lifesteal', 'damageReduction'],
    representativeSets: ['guardian', 'blood_guardian'],
    representativeSkills: ['skill_defense_stance', 'skill_life_steal', 'skill_divine_blessing'],
    countersBoss: ['enrage', 'shield'],
    weakAgainstBoss: ['lifesteal', 'highArmor'],
    uiTags: ['站得住', '回血', '挂机Boss'],
    tradeoff: '容错高但击杀慢，遇到回血 Boss 或限时收益目标时需要补爆发。',
    weights: { maxHp: 1.0, defense: 1.2, lifesteal: 1.5, damageReduction: 0.8, dodge: 0.4 }
  },
  {
    id: 'armorTrueDamage',
    name: '破甲真伤流',
    shortName: '破甲流',
    coreStats: ['penetration', 'trueDamage', 'voidDamage'],
    content: '高防 Boss',
    feedback: '无视护甲',
    question: '我是不是在绕过防御而不是硬拼面板？',
    summary: '通过穿透压低护甲收益，再用真实/虚空伤害稳定打穿高防目标。',
    representativeAffixes: ['penetration', 'trueDamage', 'voidDamage', 'damageBonusII'],
    representativeSets: ['void'],
    representativeSkills: ['skill_armor_pierce', 'skill_voidbolt', 'skill_piercing_arrow'],
    countersBoss: ['highArmor'],
    weakAgainstBoss: ['highDodge', 'enrage'],
    uiTags: ['无视护甲', '高防克星', '稳定伤害'],
    tradeoff: '打高防目标稳定，但缺少命中和爆发时会被高闪避/狂暴 Boss 惩罚。',
    weights: { penetration: 1.3, trueDamage: 1.4, voidDamage: 1.4, attack: 0.5, damageBonusII: 0.4 }
  },
  {
    id: 'speedSkill',
    name: '极速技能流',
    shortName: '技能流',
    coreStats: ['speed', 'skillDamageBonus', 'cooldownReduction'],
    content: 'ATB 体系、Boss Rush',
    feedback: '出手频率高',
    question: '我是不是靠更快出手和技能循环获胜？',
    summary: '用速度提高 ATB 节奏，用冷却和技能增伤压缩爆发周期。',
    representativeAffixes: ['speed', 'skillDamageBonus', 'cooldownReduction', 'attackSpeed'],
    representativeSets: ['swift'],
    representativeSkills: ['skill_speed_boost', 'skill_whirlwind', 'skill_chain_lightning'],
    countersBoss: ['shield', 'highDodge'],
    weakAgainstBoss: ['highArmor', 'lifesteal'],
    uiTags: ['高频出手', '多段技能', 'BossRush'],
    tradeoff: '频率高但单次穿透不足，遇到高防或强回血目标需要补真伤/爆发。',
    weights: { speed: 1.4, skillDamageBonus: 1.2, cooldownReduction: 1.0, attackSpeed: 0.8, damageBonusI: 0.5 }
  },
  {
    id: 'luckTreasure',
    name: '幸运寻宝流',
    shortName: '寻宝流',
    coreStats: ['luck'],
    content: '刷装备、刷资源',
    feedback: '掉落更多',
    question: '我是不是为了更多掉落而牺牲战斗效率？',
    summary: '用幸运提高金币、掉落和钻石收益，适合资源循环而非极限战斗。',
    representativeAffixes: ['luck', 'speed', 'accuracy'],
    representativeSets: ['fortune'],
    representativeSkills: ['skill_double_strike', 'skill_speed_boost'],
    countersBoss: ['highDodge'],
    weakAgainstBoss: ['enrage', 'highArmor', 'shield'],
    uiTags: ['掉落更多', '金币效率', '战斗偏弱'],
    tradeoff: '收益高但战斗面板刻意偏弱，卡 Boss 时应切回输出或生存流派。',
    weights: { luck: 1.8, speed: 0.5, attack: 0.25 }
  }
]

function normalizeStat(stat: StatType, value: number): number {
  const scale = STAT_SCALE[stat] || 100
  return Math.max(0, value) / scale
}

export function calculateBuildArchetypeScores(stats: PlayerStats): BuildArchetypeScore[] {
  const scores = BUILD_ARCHETYPES.map(archetype => {
    const matchedStats = Object.entries(archetype.weights).map(([stat, weight]) => {
      const statType = stat as StatType
      return {
        stat: statType,
        contribution: normalizeStat(statType, stats[statType] || 0) * (weight || 0)
      }
    }).sort((a, b) => b.contribution - a.contribution)

    const score = matchedStats.reduce((sum, item) => sum + item.contribution, 0)
    return { archetype, score, percent: 0, matchedStats }
  })

  const topScore = Math.max(...scores.map(item => item.score), 0.01)
  return scores
    .map(item => ({ ...item, percent: Math.min(100, Math.round((item.score / topScore) * 100)) }))
    .sort((a, b) => b.score - a.score)
}

export function getDominantBuildArchetype(stats: PlayerStats): BuildArchetypeScore {
  return calculateBuildArchetypeScores(stats)[0]
}
