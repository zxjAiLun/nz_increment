import type { ElementType, ElementalStatus, ElementalReactionType } from '../types'

/**
 * T71 元素反应系统
 * 元素克制关系：火克风，风克水，水克火，暗无克制
 * 反应触发：攻击者元素 + 目标元素 → 反应类型 + 效果
 */

// T71 元素反应定义
export interface ElementalReactionDef {
  type: ElementalReactionType
  name: string
  description: string
  damageMultiplier: number  // 反应伤害倍率（基于攻击力）
  buff?: {
    type: 'defenseDown' | 'damageUp' | 'stun' | 'heal'
    value: number
    duration: number
  }
}

const REACTION_DEFS: Record<string, ElementalReactionDef> = {
  burn: {
    type: 'burn',
    name: '灼烧',
    description: '每回合受到基于攻击力的持续伤害',
    damageMultiplier: 0.3,
    buff: { type: 'damageUp', value: 10, duration: 2 },
  },
  frozen: {
    type: 'frozen',
    name: '冻结',
    description: '目标无法行动1回合',
    damageMultiplier: 0,
    buff: { type: 'stun', value: 1, duration: 1 },
  },
  shocked: {
    type: 'shocked',
    name: '感电',
    description: '额外雷属性伤害',
    damageMultiplier: 0.5,
  },
  evaporate: {
    type: 'evaporate',
    name: '蒸发',
    description: '水火相遇的爆发性蒸发伤害',
    damageMultiplier: 0.8,
  },
  melt: {
    type: 'melt',
    name: '融化',
    description: '冰火相遇，伤害增加',
    damageMultiplier: 0.6,
    buff: { type: 'damageUp', value: 20, duration: 2 },
  },
  superconduct: {
    type: 'superconduct',
    name: '超导',
    description: '护甲大幅降低',
    damageMultiplier: 0.2,
    buff: { type: 'defenseDown', value: 30, duration: 2 },
  },
}

/**
 * T71 触发元素反应
 * @param attackerElement - 攻击方元素
 * @param targetElement - 目标当前附着元素
 * @param targetStatus - 目标的元素状态
 * @returns 反应结果（伤害加成、buff等）
 */
export function triggerElementalReaction(
  attackerElement: ElementType,
  targetStatus: { elemental: ElementalStatus[] }
): ElementalReactionResult | null {
  if (attackerElement === 'none') return null

  const targetElemental = targetStatus.elemental.find(e => e.stacks > 0)
  if (!targetElemental) return null

  const reaction = getReactionType(attackerElement, targetElemental.element)
  if (!reaction) return null

  const def = REACTION_DEFS[reaction]
  if (!def) return null

  return {
    type: reaction,
    name: def.name,
    description: def.description,
    extraDamage: def.damageMultiplier,
    buff: def.buff,
  }
}

/**
 * T71 获取元素反应类型
 */
export function getReactionType(
  attackerElement: ElementType,
  targetElement: ElementType
): ElementalReactionType | null {
  // 火 + 风 = 灼烧 (burn)
  if (attackerElement === 'fire' && targetElement === 'wind') return 'burn'
  if (attackerElement === 'wind' && targetElement === 'fire') return 'burn'
  // 水 + 火 = 蒸发 (evaporate)
  if (attackerElement === 'water' && targetElement === 'fire') return 'evaporate'
  if (attackerElement === 'fire' && targetElement === 'water') return 'evaporate'
  // 水 + 风 = 感电 (shocked)
  if (attackerElement === 'wind' && targetElement === 'water') return 'shocked'
  if (attackerElement === 'water' && targetElement === 'wind') return 'shocked'
  // 冰（用water表示带冰冻状态）+ 火 = 融化 (melt)
  // 冰 + 雷 = 超导 (superconduct) — 用dark暂时表示冰
  if (attackerElement === 'dark' && targetElement === 'fire') return 'melt'
  if (attackerElement === 'fire' && targetElement === 'dark') return 'melt'

  return null
}

/**
 * T71 计算元素反应伤害
 */
export function calculateReactionDamage(
  attack: number,
  reaction: ElementalReactionResult
): number {
  return Math.floor(attack * reaction.extraDamage)
}

/**
 * T71 更新目标元素状态（被攻击后）
 * 当攻击者使用某元素攻击时，目标获得该元素层
 */
export function applyElementalAttack(
  targetStatus: { elemental: ElementalStatus[] },
  attackerElement: ElementType,
  stacks: number = 1
): ElementalStatus[] {
  if (attackerElement === 'none') return targetStatus.elemental

  const existing = targetStatus.elemental.find(e => e.element === attackerElement)
  if (existing) {
    existing.stacks = Math.min(4, existing.stacks + stacks)
    existing.duration = 2 // 刷新持续时间
  } else {
    targetStatus.elemental.push({
      element: attackerElement,
      stacks: stacks,
      duration: 2,
      reaction: null,
    })
  }
  return targetStatus.elemental
}

/**
 * T71 消耗元素反应（触发后清除）
 */
export function consumeElementalReaction(
  targetStatus: { elemental: ElementalStatus[] },
  element: ElementType
): ElementalStatus[] {
  const idx = targetStatus.elemental.findIndex(e => e.element === element)
  if (idx >= 0) {
    targetStatus.elemental[idx].stacks = 0
    targetStatus.elemental[idx].duration = 0
    targetStatus.elemental[idx].reaction = null
  }
  return targetStatus.elemental
}

/**
 * T71 每回合减少元素状态持续时间
 */
export function tickElementalDuration(targetStatus: { elemental: ElementalStatus[] }): ElementalStatus[] {
  targetStatus.elemental.forEach(e => {
    if (e.stacks > 0) {
      e.duration--
      if (e.duration <= 0) {
        e.stacks = 0
      }
    }
  })
  return targetStatus.elemental
}

export interface ElementalReactionResult {
  type: ElementalReactionType
  name: string
  description: string
  extraDamage: number
  buff?: {
    type: 'defenseDown' | 'damageUp' | 'stun' | 'heal'
    value: number
    duration: number
  }
}
