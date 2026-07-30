/**
 * Rune 仓库纯视图模型（Phase 3.10 / 3.10.1）
 *
 * 只读从「Rune inventory + 玩家装备 topology」派生 UI 数据。
 * 不修改 Pinia / 装备 / inventory，不写盘，不调用 RNG，不抛异常。
 *
 * 权威派生复用既有 leaf 模块（不复制第二套映射 / 公式 / 拓扑规则）：
 *   - equipmentRunes.ts:
 *       validateRuneInventory
 *       validatePlayerRuneReferenceTopology
 *       validateEquipmentRuneSlots
 *       RUNE_TYPE_TO_STAT
 *       getRuneDisplayName / getRuneColorClass / getRuneRarityLabel
 *       getRuneEffectiveValue
 *       EQUIPMENT_SLOTS / EQUIPMENT_SLOT_NAMES
 *   - runeExperience.ts:
 *       validateRuneProgressionState
 *       getRuneExperienceProgress
 *
 * Phase 3.10.1 收口：
 *   - targets（镶嵌目标快照）与 rows 在【同一个 try/catch 安全边界】内构造，
 *     组件不得再自行遍历原始 inventory/equipment 生成 picker 数据。
 *   - 只用已经 canonical 化的 inv.inventory 建 runesById，UI 身份使用 canonical ID。
 *   - 重建 targets 引用并与 validatePlayerRuneReferenceTopology 的 references 比对，
 *     时变 getter 导致两次读取结果不一致（即使都合法）一律 fail-closed。
 */

import { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_NAMES } from '../types'
import type { Equipment, EquipmentSlot, StatType } from '../types'
import type { Rune, RuneType, RuneRarity } from '../stores/runeStore'
import {
  validateRuneInventory,
  validatePlayerRuneReferenceTopology,
  validateEquipmentRuneSlots,
  RUNE_TYPE_TO_STAT,
  getRuneDisplayName,
  getRuneColorClass,
  getRuneRarityLabel,
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
  rarityLabel: string
  effectiveValue: number
  stat: StatType
  experience: RuneExperienceProgress
  binding: RuneBindingView | null
  /** Phase 3.12：canonical 锁定状态，唯一来源为 canonical row.rune.isLocked。 */
  isLocked: boolean
}

/** 单个镶嵌孔的只读快照（来自稳定 target snapshot，canonical Rune ID）。 */
export interface RuneTargetSlotView {
  index: number
  currentRuneId: string | null
  currentRuneDisplayName: string | null
}

/** 一件装备的镶嵌目标快照（固定 3 孔，按 EQUIPMENT_SLOTS 顺序）。 */
export interface RuneEquipmentTargetView {
  equipmentSlot: EquipmentSlot
  equipmentName: string
  slots: RuneTargetSlotView[]
}

export type RuneInventoryViewResult =
  | { ok: true; rows: RuneInventoryRow[]; targets: RuneEquipmentTargetView[] }
  | { ok: false; reason: string }

export type RuneTypeFilter = 'all' | RuneType
export type RuneRarityFilter = 'all' | RuneRarity
export type RuneStatusFilter = 'all' | 'embedded' | 'unequipped'
/** Phase 3.14：锁定状态筛选（仅影响仓库卡片网格，不影响 picker / 强化面板 / 材料候选）。 */
export type RuneLockFilter = 'all' | 'locked' | 'unlocked'

export interface RuneInventoryFilter {
  type: RuneTypeFilter
  rarity: RuneRarityFilter
  status: RuneStatusFilter
  /**
   * Phase 3.14：锁定状态维度。生产组件必须显式初始化为 'all'；
   * 运行时对旧调用方 / 历史 JS 输入做防御兼容：undefined → 视为 'all'。
   */
  lock: RuneLockFilter
}

export type RuneInventorySortKey =
  | 'inventory'
  | 'rarity'
  | 'level'
  | 'effective'
  // Phase 3.17：锁定状态排序（只消费 canonical row.isLocked；同组严格按 inventoryIndex）
  | 'locked-first'
  | 'unlocked-first'

export interface RuneInventorySummary {
  total: number
  embedded: number
  unequipped: number
  /** Phase 3.14：全仓库锁定计数（canonical row.isLocked === true）。 */
  locked: number
  /** Phase 3.14：全仓库未锁定计数（canonical row.isLocked === false）。 */
  unlocked: number
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
 * 比对两次读取重建出的引用拓扑是否完全一致（含位置、无新增/消失引用）。
 * 用于拦截时变 getter 造成的 TOCTOU 不一致。
 */
function sameReferenceMap(
  topo: Map<string, { slot: EquipmentSlot; index: number }[]>,
  rebuilt: Map<string, { slot: EquipmentSlot; index: number }[]>
): boolean {
  if (topo.size !== rebuilt.size) return false
  for (const [id, refs] of topo) {
    const r = rebuilt.get(id)
    if (!r || r.length !== refs.length) return false
    const seen = new Set(refs.map(x => `${x.slot}:${x.index}`))
    for (const x of r) {
      if (!seen.has(`${x.slot}:${x.index}`)) return false
    }
  }
  return true
}

/**
 * 构建只读 Rune 仓库视图。fail-closed：任意损坏返回 { ok:false }，
 * 不抛异常、不修改输入、不产生部分结果（不隐藏损坏项继续展示）。
 *
 * 执行顺序（全部位于同一 try/catch 安全边界内）：
 *   validateRuneInventory（raw 仅此一次读取/校验）→ inv.inventory（canonical 稳定快照）建 runesById
 *   → validatePlayerRuneReferenceTopology（输入复用 inv.inventory 同一快照，不再读取 raw）
 *   → 根据 references 为每枚 Rune 派生 binding，生成 rows（只消费 inv.inventory）
 *   → 按 EQUIPMENT_SLOTS 顺序构建 targets（每件装备固定 3 孔，currentRune 走权威 helper）
 *   → 用 targets 重建引用并与 references 比对（TOCTOU 不一致 fail-closed）
 *   → postcondition（binding 与 targets 快照一致、无重复占用、固定 3 孔）
 *
 * 单次 canonical 快照原则（Phase 3.10.2 收口）：raw inventory 只在第一次
 * validateRuneInventory 中读取；后续 rows / runesById / topology / targets /
 * postcondition 全部只消费 inv.inventory，不再次索引、迭代或读取 raw input。
 */
export function buildRuneInventoryView(
  inventory: unknown,
  equipmentBySlot: unknown
): RuneInventoryViewResult {
  try {
    // 1. inventory 必须合法且 canonical ID 唯一
    const inv = validateRuneInventory(inventory)
    if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

    // 仅使用已 canonical 化的 inventory 建身份 Map（UI 不得用 raw ID）
    const runesById = new Map<string, Rune>()
    for (const r of inv.inventory) runesById.set(r.id, r)

    // 2. 装备拓扑校验（三孔损坏 / 悬空 / 同装备重复 / 跨装备重复）
    //    输入复用已 canonical 的 inv.inventory 稳定快照，避免再次读取 raw input（Phase 3.10.2）
    const topo = validatePlayerRuneReferenceTopology(equipmentBySlot, inv.inventory)
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
        rarityLabel: getRuneRarityLabel(rune),
        effectiveValue,
        stat: RUNE_TYPE_TO_STAT[rune.type] as StatType,
        experience,
        binding,
        // Phase 3.12：canonical inventory 的 isLocked 为显式 boolean（=== true 归一化防御）
        isLocked: rune.isLocked === true
      })
    }

    // 4. 按 EQUIPMENT_SLOTS 顺序构建 targets（稳定快照，所有读取位于本 try 内）
    const eqBySlot = equipmentBySlot as Partial<Record<EquipmentSlot, Equipment>>
    const targets: RuneEquipmentTargetView[] = []
    for (const slot of EQUIPMENT_SLOTS) {
      const eq = eqBySlot[slot]
      if (!eq) continue
      const v = validateEquipmentRuneSlots(eq)
      if (!v.ok) return { ok: false, reason: `equipment ${slot} runeSlots invalid: ${v.reason}` }
      const slotViews: RuneTargetSlotView[] = []
      for (let i = 0; i < v.slots.length; i++) {
        const rid = v.slots[i].runeId
        let displayName: string | null = null
        if (rid !== null) {
          const r = runesById.get(rid)
          if (!r) return { ok: false, reason: `target references unknown rune: ${rid}` }
          displayName = getRuneDisplayName(r)
        }
        slotViews.push({ index: i, currentRuneId: rid, currentRuneDisplayName: displayName })
      }
      targets.push({
        equipmentSlot: slot,
        equipmentName: eq.name ?? EQUIPMENT_SLOT_NAMES[slot],
        slots: slotViews
      })
    }

    // 5. 重建 targets 引用并与 topology references 比对（TOCTOU 不一致 fail-closed）
    const rebuilt = new Map<string, { slot: EquipmentSlot; index: number }[]>()
    for (const t of targets) {
      for (const s of t.slots) {
        if (s.currentRuneId === null) continue
        const arr = rebuilt.get(s.currentRuneId) ?? []
        arr.push({ slot: t.equipmentSlot, index: s.index })
        rebuilt.set(s.currentRuneId, arr)
      }
    }
    if (!sameReferenceMap(references, rebuilt)) {
      return { ok: false, reason: 'rune reference topology changed between reads' }
    }

    // 6. postcondition：基于 targets 稳定快照（不再重新读取原始 equipment）
    const occupied = new Map<string, string>() // key "slot:index" -> runeId
    for (const t of targets) {
      for (const s of t.slots) {
        if (s.currentRuneId === null) continue
        const key = `${t.equipmentSlot}:${s.index}`
        if (occupied.has(key)) return { ok: false, reason: 'duplicate rune in same slot' }
        occupied.set(key, s.currentRuneId)
      }
    }
    for (const row of rows) {
      if (!row.binding) continue
      const key = `${row.binding.equipmentSlot}:${row.binding.runeSlotIndex}`
      if (occupied.get(key) !== row.rune.id) {
        return { ok: false, reason: 'binding inconsistent with equipment topology' }
      }
    }

    return { ok: true, rows, targets }
  } catch {
    return { ok: false, reason: 'rune inventory view threw' }
  }
}

/**
 * 本地 UI 筛选（不持久化）。基于纯视图 rows，不修改输入 inventory/equipment，不写盘。
 * 返回新数组。
 */
export function filterRuneRows(rows: RuneInventoryRow[], filter: RuneInventoryFilter): RuneInventoryRow[] {
  // Phase 3.14 防御兼容：旧调用方 / 历史 JS 输入缺失 lock → 视为 'all'（不按锁定过滤）。
  // 锁定判断唯一来源为 canonical row.isLocked（严格 ===），
  // 不读取 row.rune.isLocked raw 字段、不做 truthy/falsy 判断、不看 DOM。
  const lock: RuneLockFilter = filter.lock === undefined ? 'all' : filter.lock
  const result: RuneInventoryRow[] = []
  for (const row of rows) {
    if (filter.type !== 'all' && row.rune.type !== filter.type) continue
    if (filter.rarity !== 'all' && row.rune.rarity !== filter.rarity) continue
    if (filter.status === 'embedded' && !row.binding) continue
    if (filter.status === 'unequipped' && row.binding) continue
    if (lock === 'locked' && row.isLocked !== true) continue
    if (lock === 'unlocked' && row.isLocked !== false) continue
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
    // Phase 3.17：锁定状态排序。唯一来源为 canonical row.isLocked（=== true 归一化），
    // 不读取 row.rune.isLocked raw 字段、不做 truthy/falsy 判断、不看 DOM。
    // locked-first：已锁定组在前；unlocked-first：未锁定组在前。
    // 同组严格按 inventoryIndex 升序（tie-breaker 稳定、确定性、无 RNG）。
    case 'locked-first':
      copy.sort((a, b) => {
        const la = a.isLocked === true ? 0 : 1 // 锁定组 rank 0
        const lb = b.isLocked === true ? 0 : 1
        if (la !== lb) return la - lb
        return a.inventoryIndex - b.inventoryIndex
      })
      break
    case 'unlocked-first':
      copy.sort((a, b) => {
        const la = a.isLocked === true ? 1 : 0 // 未锁定组 rank 0（锁定组 rank 1 在后）
        const lb = b.isLocked === true ? 1 : 0
        if (la !== lb) return la - lb
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
  // Phase 3.14：锁定计数唯一来源为 canonical row.isLocked（=== true）。
  // 旧档缺失 isLocked 的 Rune 已由 buildRuneInventoryView 归一化为 false → 计入 unlocked。
  let locked = 0
  for (const row of rows) {
    byRarity[row.rune.rarity] = (byRarity[row.rune.rarity] ?? 0) + 1
    if (row.binding) embedded++
    if (row.isLocked === true) locked++
  }
  return {
    total: rows.length,
    embedded,
    unequipped: rows.length - embedded,
    locked,
    unlocked: rows.length - locked,
    byRarity
  }
}
