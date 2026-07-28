import { defineStore } from 'pinia'
import { computed } from 'vue'
import { RUNE_EXP_TABLE } from '../utils/runeExperience'
import { planRuneGeneration } from '../utils/runeGeneration'

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
 * Phase 3.7 —— 经验表与升级逻辑收口到 src/utils/runeExperience.ts（唯一事实来源）：
 *   本 store 不再内部重算经验表，仅从 runeExperience 导入/委托，避免第二份公式。
 *
 * Phase 3.8 —— 生成规则收口到 src/utils/runeGeneration.ts（唯一事实来源）：
 *   本 store 不再内联 types / rarity 阈值 / baseStat / multiplier / ID 拼接，
 *   generateRune 仅委托纯规划 planRuneGeneration()，避免第二份概率与基础数值。
 *
 * 本文件仅保留动态 Rune 类型与生产生成器入口。符文击杀掉率、掉落接入、套装效果、
 * 合成等属后续独立阶段，不在此实现。
 */

// 符文类型
export type RuneType = 'attack' | 'defense' | 'health' | 'crit' | 'speed' | 'luck'

// 符文稀有度
export type RuneRarity = 'common' | 'rare' | 'epic' | 'legend'

// 动态 Rune（生产模型）。无 slotIndex / equippedTo：绑定完全由装备拓扑派生。
// Phase 3.12：isLocked 为可选字段（旧存档兼容——缺失视为未锁定，由 validateRune 迁移为 false）。
// 禁止 lockedRuneIds / 独立锁定数组 / 新 localStorage key：锁定状态只存在于 Rune 对象上。
export interface Rune {
  id: string
  type: RuneType
  rarity: RuneRarity
  level: number
  exp: number
  statValue: number
  isLocked?: boolean
}

/**
 * Canonical Rune（Phase 3.12）：经 validateRune 校验后的规范形态，
 * isLocked 必为显式 boolean（缺失/undefined 已迁移为 false）。
 * validator（equipmentRunes.validateRune）是锁定字段的唯一 canonical 边界。
 */
export type CanonicalRune = Omit<Rune, 'isLocked'> & { isLocked: boolean }

export const useRuneStore = defineStore('rune', () => {
  // 经验表与升级逻辑统一委托 runeExperience.ts（Phase 3.7 唯一事实来源），只读暴露 expTable。
  // 以 computed 委托“同一份冻结数组引用”，确保 Object.isFrozen(expTable) 为 true、
  // 任何调用方都无法修改经验曲线（Phase 3.7.1）。
  const expTable = computed<readonly number[]>(() => RUNE_EXP_TABLE)

  // 生成随机符文（后续掉落阶段接入；本阶段仅保留生产模型入口，不自动入库）。
  // 生成规则唯一来源为 runeGeneration.planRuneGeneration；本函数仅负责提供 timestamp 并委托。
  //   - timestamp 显式提供 → 不读取 Date.now
  //   - timestamp 缺失 → 在函数体 try/catch 内读取 Date.now 一次（不用默认参数，
  //     因为默认参数求值发生在 try/catch 之前，Date.now 抛异常将逃逸）
  //   - plan 成功 → 返回 Rune；plan 失败或 Date.now 抛异常 → 返回 null
  // 正常调用（无参数）仍恰好消费 3 次 Math.random，顺序 type → rarity → ID 后缀。
  function generateRune(rng: () => number = Math.random, timestamp?: number): Rune | null {
    try {
      // 严格区分“缺省”与“显式非法”（Phase 3.8.1 P1-B）：
      //   - timestamp === undefined → 视为缺省，读取 Date.now 一次
      //   - timestamp 显式为合法 number → 不读取 Date.now
      //   - timestamp 显式为 null / 字符串 / 对象 / 数组 / boolean → 原样交给 planRuneGeneration，
      //     isValidTimestamp 拒绝（任意非有限正整数），RNG 0 次、返回 null
      // 禁止 typeof timestamp === 'number' ? timestamp : Date.now()（会把显式非法值吞掉）。
      const ts: unknown = timestamp === undefined ? Date.now() : timestamp
      const plan = planRuneGeneration(rng, ts)
      return plan.ok ? plan.rune : null
    } catch {
      return null
    }
  }

  return {
    expTable,
    generateRune
  }
})
