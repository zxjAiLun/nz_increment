import { defineStore } from 'pinia'
import { computed } from 'vue'

/**
 * Phase 3.6 —— 装备符文的唯一生产模型（单一事实来源）。
 *
 * 关键约束（收口双模型）：
 *   - 旧 runeStore 同时维护“全局 5 槽镶嵌”（equippedRunes / equipRune / unequipRune /
 *     activeSetEffects / totalRuneStats）与“装备 runeSlots”两套镶嵌模型，并公开两套
 *     mutating API。本阶段删除全局 5 槽路径：装备绑定状态完全由装备拓扑
 *     （player.equipment[*].runeSlots）派生，Rune 对象本身不可变。
 *   - 旧 Rune 含 `slotIndex` 字段（易与 equipment.runeSlots 分叉）。本阶段移除该字段，
 *     绑定状态完全由装备拓扑派生（不维护 Rune.slotIndex / Rune.equippedTo）。
 *   - UI 展示不再使用 src/data/runes.ts 的静态 Rune 身份模型；动态 inventory 由
 *     playerStore 持久化并校验（见 equipmentRunes.ts）。
 *
 * 本文件仅保留动态 Rune 类型与生产生成器。符文生成/掉落概率、升级/经验、套装效果等
 * 属后续独立阶段，不在此实现。
 */

// 符文类型
export type RuneType = 'attack' | 'defense' | 'health' | 'crit' | 'speed' | 'luck'

// 符文稀有度
export type RuneRarity = 'common' | 'rare' | 'epic' | 'legend'

// 动态 Rune（生产模型）。无 slotIndex / equippedTo：绑定完全由装备拓扑派生。
export interface Rune {
  id: string
  type: RuneType
  rarity: RuneRarity
  level: number
  exp: number
  statValue: number
}

// 符文经验表（升级阶段使用）
const RUNE_EXP_TABLE = computed(() => {
  const table: number[] = [0]
  for (let i = 1; i <= 50; i++) {
    table[i] = table[i - 1] + Math.floor(20 * Math.pow(1.1, i))
  }
  return table
})

export const useRuneStore = defineStore('rune', () => {
  const expTable = RUNE_EXP_TABLE

  // 生成随机符文（后续掉落阶段接入；本阶段仅保留生产模型，不自动入库）
  function generateRune(): Rune {
    const types: RuneType[] = ['attack', 'defense', 'health', 'crit', 'speed', 'luck']
    const type = types[Math.floor(Math.random() * types.length)]
    const rarityRoll = Math.random()
    let rarity: RuneRarity
    if (rarityRoll < 0.6) rarity = 'common'
    else if (rarityRoll < 0.85) rarity = 'rare'
    else if (rarityRoll < 0.97) rarity = 'epic'
    else rarity = 'legend'

    const baseStat: Record<RuneType, number> = {
      attack: 10, defense: 8, health: 50, crit: 3, speed: 5, luck: 5
    }
    const multiplier = { common: 1, rare: 1.5, epic: 2, legend: 3 }[rarity]

    return {
      id: `rune_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type,
      rarity,
      level: 1,
      exp: 0,
      statValue: Math.floor(baseStat[type] * multiplier)
    }
  }

  return {
    expTable,
    generateRune
  }
})
