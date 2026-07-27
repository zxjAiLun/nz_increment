/**
 * Rune 仓库纯视图模型（Phase 3.10）
 *
 * 只读从「Rune inventory + 玩家装备 topology」派生 UI 数据。
 * 不修改 Pinia / 装备 / inventory，不写盘，不调用 RNG，不抛异常。
 *
 * 权威派生复用既有 leaf 模块（不复制第二套映射 / 公式 / 拓扑规则）：
 *   - equipmentRunes.ts:
 *       validateRuneInventory
 *       validatePlayerRuneReferenceTopology
 *       RUNE_TYPE_TO_STAT
 *       getRuneDisplayName / getRuneColorClass
 *       getRuneEffectiveValue
 *   - runeExperience.ts:
 *       validateRuneProgressionState
 *       getRuneExperienceProgress
 */

import type { Equipment, EquipmentSlot, StatType } from '../types'
import type { Rune, RuneType, RuneRarity } from '../stores/runeStore'
import {
  validateRuneInventory,
  validatePlayerRuneReferenceTopology,
  RUNE_TYPE_TO_STAT,
  getRuneDisplayName,
  getRuneColorClass,
  getRuneEffectiveValue
} from './equipmentRunes'
import { validateRuneProgressionState, getRuneExperienceProgress } from './runeExperience'
import type { RuneExperienceProgress } from './runeExperience'

/** 一枚 Rune 的当前镶嵌位置（由装备 topology 派生）。 */
export interface RuneBindingView {
  equipmentSlot: EquipmentSlot
  runeSlotIndex: number
}

/** 仓库中一枚 Rune 的只读展示行。 */
export interface RuneInventoryRow {
  inventoryIndex: number
  rune: Rune
  displayName: string
  colorClass: string
  effectiveValue: number
  stat: StatType
  experience: RuneExperienceProgress
  binding: RuneBindingView | null
}

export type RuneInventoryViewResult =
  | { ok: true; rows: RuneInventoryRow[] }
  | { ok: false; reason: string }

export type RuneTypeFilter = 'all' | RuneType
export type RuneRarityFilter = 'all' | RuneRarity
export type RuneStatusFilter = 'all' | 'embedded' | 'unequipped'

export interface RuneInventoryFilter {
  type: RuneTypeFilter
  rarity: RuneRarityFilter
  status: RuneStatusFilter
}

export type RuneInventorySortKey = 'inventory' | 'rarity' | 'level' | 'effective'

export interface RuneInventorySummary {
  total: number
  embedded: number
  unequipped: number
  byRarity: Record<RuneRarity, number>
}

/** 稀有度排序权重（高稀有度优先）。仅排序用，不复制中文名映射。 */
const RARITY_RANK: Record<RuneRarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legend: 3
}

/**
 * 构建只读 Rune 仓库视图。fail-closed：任意损坏返回 { ok:false }，
 * 不抛异常、不修改输入、不产生部分结果（不隐藏损坏项继续展示）。
 *
 * 执行顺序：
 *   validateRuneInventory
 *   → validatePlayerRuneReferenceTopology（建立 references Map）
 *   → 根据 references 为每枚 Rune 派生 binding
 *   → 生成 rows
 *   → postcondition（binding 与装备槽位一致、无重复占用）
 */
export function buildRuneInventoryView(
  inventory: unknown,
  equipmentBySlot: unknown
): RuneInventoryViewResult {
  try {
    // 1. inventory 必须合法且 canonical ID 唯一
    const inv = validateRuneInventory(inventory)
    if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

    // 2. 装备拓扑校验（三孔损坏 / 悬空 / 同装备重复 / 跨装备重复）
    const topo = validatePlayerRuneReferenceTopology(equipmentBySlot, inventory)
    if (!topo.ok) return { ok: false, reason: `topology invalid: ${topo.reason}` }

    const references = topo.references

    // 3. 每枚 Rune 派生一行
    const rows: RuneInventoryRow[] = []
    for (let i = 0; i < inv.inventory.length; i++) {
      const rune = inv.inventory[i]

      // 进度状态非法 → fail-closed
      const prog = validateRuneProgressionState(rune)
      if (!prog.ok) return { ok: false, reason: `rune progression invalid: ${prog.reason}` }

      // 有效属性必须有限非负整数
      const effectiveValue = getRuneEffectiveValue(rune.statValue, rune.level)
      if (!Number.isInteger(effectiveValue) || effectiveValue < 0) {
        return { ok: false, reason: 'invalid effective value' }
      }

      // 经验进度（已通过 validateRune + validateRuneProgressionState，必非空）
      const experience = getRuneExperienceProgress(rune)
      if (!experience) return { ok: false, reason: 'rune experience progress invalid' }

      // binding：references 中该 id 恰好一处引用 → 唯一位置；否则未镶嵌
      const refs = references.get(rune.id)
      const binding: RuneBindingView | null =
        refs && refs.length === 1
          ? { equipmentSlot: refs[0].slot, runeSlotIndex: refs[0].index }
          : null

      rows.push({
        inventoryIndex: i,
        rune,
        displayName: getRuneDisplayName(rune),
        colorClass: getRuneColorClass(rune),
        effectiveValue,
        stat: RUNE_TYPE_TO_STAT[rune.type] as StatType,
        experience,
        binding
      })
    }

    // 4. postcondition：binding 与装备实际槽位一致、同一槽位不被两 Rune 占用
    const occupied = new Set<string>()
    for (const row of rows) {
      if (!row.binding) continue
      const key = `${row.binding.equipmentSlot}:${row.binding.runeSlotIndex}`
      if (occupied.has(key)) return { ok: false, reason: 'duplicate binding slot' }
      occupied.add(key)
      const eq = (equipmentBySlot as Partial<Record<EquipmentSlot, Equipment>>)[row.binding.equipmentSlot]
      const slot = eq?.runeSlots?.[row.binding.runeSlotIndex]
      if (!slot || slot.runeId !== row.rune.id) {
        return { ok: false, reason: 'binding inconsistent with equipment topology' }
      }
    }

    return { ok: true, rows }
  } catch {
    return { ok: false, reason: 'rune inventory view threw' }
  }
}

/**
 * 本地 UI 筛选（不持久化）。基于纯视图 rows，不修改输入 inventory/equipment，不写盘。
 * 返回新数组。
 */
export function filterRuneRows(rows: RuneInventoryRow[], filter: RuneInventoryFilter): RuneInventoryRow[] {
  const result: RuneInventoryRow[] = []
  for (const row of rows) {
    if (filter.type !== 'all' && row.rune.type !== filter.type) continue
    if (filter.rarity !== 'all' && row.rune.rarity !== filter.rarity) continue
    if (filter.status === 'embedded' && !row.binding) continue
    if (filter.status === 'unequipped' && row.binding) continue
    result.push(row)
  }
  return result
}

/**
 * 确定性排序。创建新数组，绝不修改输入。tie-breaker 严格按规格，
 * 不依赖 ID timestamp / 名称 localeCompare / 对象引用 / Math.random / 当前时间。
 */
export function sortRuneRows(rows: RuneInventoryRow[], sortBy: RuneInventorySortKey): RuneInventoryRow[] {
  const copy = rows.slice()
  const rarityRank = (row: RuneInventoryRow): number => RARITY_RANK[row.rune.rarity] ?? -1

  switch (sortBy) {
    case 'inventory':
      copy.sort((a, b) => a.inventoryIndex - b.inventoryIndex)
      break
    case 'rarity':
      copy.sort((a, b) => {
        const diff = rarityRank(b) - rarityRank(a) // 高稀有度优先
        if (diff !== 0) return diff
        return a.inventoryIndex - b.inventoryIndex
      })
      break
    case 'level':
      copy.sort((a, b) => {
        if (b.rune.level !== a.rune.level) return b.rune.level - a.rune.level
        const rd = rarityRank(b) - rarityRank(a)
        if (rd !== 0) return rd
        return a.inventoryIndex - b.inventoryIndex
      })
      break
    case 'effective':
      copy.sort((a, b) => {
        if (b.effectiveValue !== a.effectiveValue) return b.effectiveValue - a.effectiveValue
        if (b.rune.level !== a.rune.level) return b.rune.level - a.rune.level
        return a.inventoryIndex - b.inventoryIndex
      })
      break
  }
  return copy
}

/**
 * 页面摘要。必须来自同一份合法 view rows，不得另行遍历未经校验的原始 inventory。
 */
export function summarizeRuneRows(rows: RuneInventoryRow[]): RuneInventorySummary {
  const byRarity: Record<RuneRarity, number> = { common: 0, rare: 0, epic: 0, legend: 0 }
  let embedded = 0
  for (const row of rows) {
    byRarity[row.rune.rarity] = (byRarity[row.rune.rarity] ?? 0) + 1
    if (row.binding) embedded++
  }
  return {
    total: rows.length,
    embedded,
    unequipped: rows.length - embedded,
    byRarity
  }
}
