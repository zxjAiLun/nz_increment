/**
 * 技能执行器 Composable
 * 统一管理技能伤害计算与效果执行
 */
import type { Skill, PlayerStats, Monster } from '../types'

export interface SkillResult {
  damage: number
  isCrit: boolean
  trueDamagePart: number
  heal: number
  buffs: Array<{ stat: string; percentBoost: number; duration: number }>
  shield?: number
  lifesteal?: number
}

/**
 * 根据技能属性计算总伤害
 * 基础伤害 = attack * damageMultiplier * hitCount
 */
export function calculateSkillBaseDamage(skill: Skill, playerStats: PlayerStats): number {
  if (!skill.damageMultiplier) return 0
  const hits = skill.hitCount || 1
  return Math.floor(playerStats.attack * skill.damageMultiplier * hits)
}

/**
 * 执行单个技能并返回效果结果
 * 注意：此函数仅计算技能效果，不处理冷却、buff apply 等副作用
 */
export function executeSkillLogic(
  skill: Skill,
  playerStats: PlayerStats,
  monster: Monster | null
): SkillResult {
  const result: SkillResult = {
    damage: 0,
    isCrit: false,
    trueDamagePart: skill.trueDamage || 0,
    heal: 0,
    buffs: []
  }

  // 治疗技能
  if (skill.type === 'heal' && skill.healPercent) {
    result.heal = skill.healPercent
    return result
  }

  // 伤害技能：基础伤害 = attack * multiplier * hitCount
  if (skill.type === 'damage' && skill.damageMultiplier > 0 && monster) {
    const baseDamage = calculateSkillBaseDamage(skill, playerStats)
    result.damage = baseDamage + skill.trueDamage
  }

  // 增益技能
  if (skill.type === 'buff' && skill.buffEffect) {
    result.buffs.push({
      stat: skill.buffEffect.stat,
      percentBoost: skill.buffEffect.percentBoost,
      duration: skill.buffEffect.duration
    })
  }

  // 护盾技能（能量护盾：200%攻击力）
  if (skill.id === 'skill_energy_shield') {
    result.shield = Math.floor(playerStats.attack * 2)
  }

  // 生命偷取技能
  if (skill.lifesteal) {
    result.lifesteal = skill.lifesteal
  }

  return result
}

/**
 * 根据技能类型生成描述性结果文本
 */
export function describeSkillResult(_skill: Skill, result: SkillResult): string[] {
  const lines: string[] = []

  if (result.damage > 0) {
    lines.push(`造成 ${result.damage} 点伤害`)
    if (result.trueDamagePart > 0) {
      lines.push(`（含 ${result.trueDamagePart} 真实伤害）`)
    }
  }

  if (result.heal > 0) {
    lines.push(`恢复 ${result.heal}% 最大生命`)
  }

  if (result.buffs.length > 0) {
    for (const buff of result.buffs) {
      lines.push(`${buff.stat} +${buff.percentBoost}%，持续${buff.duration}秒`)
    }
  }

  if (result.shield) {
    lines.push(`护盾吸收 ${result.shield} 点伤害`)
  }

  if (result.lifesteal) {
    lines.push(`生命偷取 ${result.lifesteal}%`)
  }

  return lines
}

export function useSkillExecutor() {
  return {
    calculateSkillBaseDamage,
    executeSkillLogic,
    describeSkillResult
  }
}
