import type { ConditionExpression, ConditionalPassiveEffect, StatType } from '../types'

/**
 * 被动技能加成接口（用于评估后的结果）
 */
export interface PassiveStatBonus {
  stat: StatType
  value: number
  type: 'flat' | 'percent'
}

export function evaluateCondition(
  condition: ConditionExpression,
  playerHpPercent: number,
  combo: number,
  isBoss: boolean,
  turnCount: number,
  speed: number
): boolean {
  let fieldValue: number | string

  switch (condition.field) {
    case 'hpPercent':
      fieldValue = playerHpPercent
      break
    case 'combo':
      fieldValue = combo
      break
    case 'isBoss':
      fieldValue = isBoss ? 1 : 0
      break
    case 'turnCount':
      fieldValue = turnCount
      break
    case 'speed':
      fieldValue = speed
      break
    default:
      fieldValue = 0
  }

  switch (condition.operator) {
    case '<': return (fieldValue as number) < (condition.value as number)
    case '>': return (fieldValue as number) > (condition.value as number)
    case '>=': return (fieldValue as number) >= (condition.value as number)
    case '<=': return (fieldValue as number) <= (condition.value as number)
    case '==': return fieldValue == condition.value
    case 'has': return String(fieldValue).includes(String(condition.value))
    default: return false
  }
}

export function applyPassiveEffects(
  passives: ConditionalPassiveEffect[],
  playerCurrentHp: number,
  playerMaxHp: number,
  combo: number,
  isBoss: boolean,
  turnCount: number,
  speed: number
): PassiveStatBonus[] {
  const bonuses: PassiveStatBonus[] = []
  const hpPercent = (playerCurrentHp / playerMaxHp) * 100

  for (const passive of passives) {
    if (passive.type === 'static') {
      if (passive.effect.stat && passive.effect.value !== undefined) {
        bonuses.push({
          stat: passive.effect.stat,
          value: passive.effect.value,
          type: passive.effect.type || 'flat'
        })
      }
    } else if (passive.type === 'conditional' && passive.condition) {
      if (evaluateCondition(passive.condition, hpPercent, combo, isBoss, turnCount, speed)) {
        if (passive.effect.stat && passive.effect.value !== undefined) {
          bonuses.push({
            stat: passive.effect.stat,
            value: passive.effect.value,
            type: passive.effect.type || 'flat'
          })
        }
      }
    }
  }

  return bonuses
}
