/**
 * 装备符文 —— 唯一纯模块（Phase 3.6）
 *
 * 本文件是“装备符文基础镶嵌闭环”的唯一事实来源，取代旧 runeStore 中：
 *   - 全局 5 槽镶嵌路径（equippedRunes / equipRune / unequipRune）
 *   - 装备级 embedRune / removeRune / getRuneStats
 *   - 双 Rune 模型（Rune.slotIndex）
 *
 * 设计约束：
 *   - 所有函数纯函数、不调用 RNG、不抛异常（malformed 一律返回失败结果）。
 *   - Rune 的装备绑定状态完全由装备拓扑派生（equipment.runeSlots），Rune 对象本身不可变。
 *   - 生产镶嵌/移除只经 playerStore 的原子事务（tryEmbedEquipmentRune / tryRemoveEquipmentRune），
 *     且这些事务只调用本文件的 plan* 纯规划。
 *   - 加权/套装/生成/升级/回收等一律不在此处理（后续独立阶段）。
 */

import type { Equipment, EquipmentSlot, RuneSlot, StatBonus, StatType } from '../types'
import type { Rune, RuneType, RuneRarity } from '../stores/runeStore'
import { EQUIPMENT_SLOTS } from '../types'
import { validateEquipmentForEconomy } from './equipmentReplacement'

/** 装备符文孔位数量（固定 3 孔） */
export const EQUIPMENT_RUNE_SLOT_COUNT = 3

/** Rune 类型 → 真实属性（唯一映射来源） */
export const RUNE_TYPE_TO_STAT = {
  attack: 'attack',
  defense: 'defense',
  health: 'maxHp',
  crit: 'critRate',
  speed: 'speed',
  luck: 'luck'
} as const

/** Rune 类型 → 展示颜色（替代静态 RUNES 的 color 字段；由类型派生，不再依赖静态权威） */
export const RUNE_TYPE_COLORS: Record<RuneType, string> = {
  attack: 'red',
  defense: 'blue',
  health: 'green',
  crit: 'yellow',
  speed: 'yellow',
  luck: 'purple'
}

const RUNE_RARITY_LABELS: Record<RuneRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legend: '传说'
}

const RUNE_TYPE_LABELS: Record<RuneType, string> = {
  attack: '攻击',
  defense: '防御',
  health: '生命',
  crit: '暴击',
  speed: '速度',
  luck: '幸运'
}

/** 符文基础加成公式生长系数（与旧 runeStore.totalRuneStats 一致，唯一来源） */
const RUNE_EFFECTIVE_VALUE_GROWTH = 0.05

const RUNE_TYPES: RuneType[] = ['attack', 'defense', 'health', 'crit', 'speed', 'luck']
const RUNE_RARITIES: RuneRarity[] = ['common', 'rare', 'epic', 'legend']

/**
 * 符文有效属性值：floor(statValue × (1 + (level - 1) × 0.05))
 * 保留当前公式数值；输入非法时返回 0（fail-closed）。
 */
export function getRuneEffectiveValue(statValue: number, level: number): number {
  if (typeof statValue !== 'number' || !Number.isFinite(statValue) || statValue < 0) return 0
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 1) return Math.floor(statValue)
  return Math.floor(statValue * (1 + (level - 1) * RUNE_EFFECTIVE_VALUE_GROWTH))
}

/** 由动态 Rune 派生展示名（不再使用静态 RUNES.find()） */
export function getRuneDisplayName(rune: { type: RuneType; rarity: RuneRarity }): string {
  return `${RUNE_RARITY_LABELS[rune.rarity]}${RUNE_TYPE_LABELS[rune.type]}符文`
}

/** 由动态 Rune 派生展示颜色 class（不再使用静态 RUNES 的 color 字段） */
export function getRuneColorClass(rune: { type: RuneType }): string {
  return RUNE_TYPE_COLORS[rune.type] ?? ''
}

/**
 * 创建三个空符文孔。必须是纯确定性、不调用 RNG。
 */
export function createEmptyEquipmentRuneSlots(): RuneSlot[] {
  return [
    { index: 0, runeId: null },
    { index: 1, runeId: null },
    { index: 2, runeId: null }
  ]
}

// ----------------------------- Rune / inventory 校验 -----------------------------

export type RuneValidationResult =
  | { ok: true; rune: Rune }
  | { ok: false; reason: string }

/** 校验单个动态 Rune（生产模型）。任意 malformed 返回失败，不抛异常。 */
export function validateRune(raw: unknown): RuneValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'rune must be a non-null object' }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return { ok: false, reason: 'rune.id must be a string' }
  const id = r.id.trim()
  if (id.length === 0) return { ok: false, reason: 'rune.id must be non-empty after trim' }
  if (typeof r.type !== 'string' || !RUNE_TYPES.includes(r.type as RuneType)) {
    return { ok: false, reason: 'rune.type invalid' }
  }
  if (typeof r.rarity !== 'string' || !RUNE_RARITIES.includes(r.rarity as RuneRarity)) {
    return { ok: false, reason: 'rune.rarity invalid' }
  }
  if (typeof r.level !== 'number' || !Number.isFinite(r.level) || !Number.isInteger(r.level) || r.level < 1 || r.level > 50) {
    return { ok: false, reason: 'rune.level must be integer 1..50' }
  }
  if (typeof r.exp !== 'number' || !Number.isFinite(r.exp) || !Number.isInteger(r.exp) || r.exp < 0) {
    return { ok: false, reason: 'rune.exp must be finite non-negative integer' }
  }
  if (typeof r.statValue !== 'number' || !Number.isFinite(r.statValue) || !Number.isInteger(r.statValue) || r.statValue < 0) {
    return { ok: false, reason: 'rune.statValue must be finite non-negative integer' }
  }
  return {
    ok: true,
    rune: {
      id,
      type: r.type as RuneType,
      rarity: r.rarity as RuneRarity,
      level: r.level,
      exp: r.exp,
      statValue: r.statValue
    }
  }
}

export type RuneInventoryValidationResult =
  | { ok: true; inventory: Rune[] }
  | { ok: false; reason: string }

/** 校验整个 Rune inventory：必须是数组、每个 Rune 合法、所有 id 唯一。 */
export function validateRuneInventory(raw: unknown): RuneInventoryValidationResult {
  if (!Array.isArray(raw)) return { ok: false, reason: 'rune inventory must be an array' }
  const out: Rune[] = []
  const ids = new Set<string>()
  for (const item of raw) {
    const v = validateRune(item)
    if (!v.ok) return { ok: false, reason: `invalid rune in inventory: ${v.reason}` }
    if (ids.has(v.rune.id)) return { ok: false, reason: 'duplicate rune id in inventory' }
    ids.add(v.rune.id)
    out.push(v.rune)
  }
  return { ok: true, inventory: out }
}

/**
 * 安全水合 inventory：损坏或缺失 → 空数组（不抛异常、不注入非法 Rune）。
 * 供 loadGame 使用，确保“损坏 inventory 不得把非法 Rune 注入运行时”。
 */
export function normalizeRuneInventory(raw: unknown): Rune[] {
  const v = validateRuneInventory(raw)
  return v.ok ? v.inventory : []
}

// ----------------------------- 装备符文槽校验 -----------------------------

export type EquipmentRuneSlotsValidationResult =
  | { ok: true; slots: RuneSlot[] }
  | { ok: false; reason: string }

/**
 * 校验一件装备的符文槽结构。复用 validateEquipmentForEconomy 先确保装备经济合法，
 * 再要求：runeSlots 是数组、长度严格等于 3、每槽是对象、index 有限非负整数且 === 数组位置、
 * runeId 为 null 或 trim 后非空字符串、同一件装备内不得重复 runeId。
 * 损坏结构返回失败（fail-closed），不读取部分槽位。
 */
export function validateEquipmentRuneSlots(equipment: unknown): EquipmentRuneSlotsValidationResult {
  const econ = validateEquipmentForEconomy(equipment)
  if (!econ.ok) return { ok: false, reason: `equipment economy invalid: ${econ.reason}` }
  const eq = equipment as Equipment
  if (!Array.isArray(eq.runeSlots)) return { ok: false, reason: 'runeSlots must be an array' }
  if (eq.runeSlots.length !== EQUIPMENT_RUNE_SLOT_COUNT) {
    return { ok: false, reason: `runeSlots length must be ${EQUIPMENT_RUNE_SLOT_COUNT}` }
  }
  const seenIds = new Set<string>()
  for (let i = 0; i < eq.runeSlots.length; i++) {
    const slot = eq.runeSlots[i]
    if (!slot || typeof slot !== 'object') return { ok: false, reason: `rune slot ${i} must be an object` }
    if (typeof slot.index !== 'number' || !Number.isFinite(slot.index) || !Number.isInteger(slot.index) || slot.index < 0) {
      return { ok: false, reason: `rune slot ${i} index must be a finite non-negative integer` }
    }
    if (slot.index !== i) return { ok: false, reason: `rune slot index must equal array position ${i}` }
    if (slot.runeId !== null && (typeof slot.runeId !== 'string' || slot.runeId.trim().length === 0)) {
      return { ok: false, reason: `rune slot ${i} runeId must be null or non-empty string` }
    }
    if (typeof slot.runeId === 'string') {
      if (seenIds.has(slot.runeId)) return { ok: false, reason: `duplicate runeId in equipment runeSlots: ${slot.runeId}` }
      seenIds.add(slot.runeId)
    }
  }
  return { ok: true, slots: eq.runeSlots as RuneSlot[] }
}

/**
 * loadGame 旧装备迁移：
 *   - 合法三孔 → 保持原样
 *   - 缺失 / 空数组 → 三个空孔
 *   - 非空但损坏（长度 1/2/4、重复 index、index≠位置、runeId 非字符串、重复 runeId、slot=null）
 *     → 完整判断损坏后整体清空为三空孔（不保留部分 runeId）
 * 不应用任何符文属性、不触发镶嵌事务。损坏装备（经济无效）直接跳过。
 */
export function normalizeEquipmentRuneSlots(equipment: Equipment): void {
  const econ = validateEquipmentForEconomy(equipment)
  if (!econ.ok) return // 损坏装备：保持安全，不迁移
  const validation = validateEquipmentRuneSlots(equipment)
  if (validation.ok) return // 已合法，保持原样
  // 缺失或空数组 → 三空孔
  if (!Array.isArray(equipment.runeSlots) || equipment.runeSlots.length === 0) {
    equipment.runeSlots = createEmptyEquipmentRuneSlots()
    return
  }
  // 非空但损坏 → 整体清空（不保留部分 runeId）
  equipment.runeSlots = createEmptyEquipmentRuneSlots()
}

// ----------------------------- 全局拓扑对账 -----------------------------

export interface EquipmentRuneSlotRef {
  slot: EquipmentSlot
  index: number
}

/**
 * 扫描全部已装备物品，建立 runeId → 所有装备位置[] 的拓扑。
 * 不修改任何输入。
 */
export function scanRuneReferences(
  equipmentBySlot: Partial<Record<EquipmentSlot, Equipment>>
): Map<string, EquipmentRuneSlotRef[]> {
  const refMap = new Map<string, EquipmentRuneSlotRef[]>()
  for (const slot of EQUIPMENT_SLOTS) {
    const eq = equipmentBySlot[slot]
    if (!eq || !Array.isArray(eq.runeSlots)) continue
    for (let i = 0; i < eq.runeSlots.length; i++) {
      const runeId = eq.runeSlots[i]?.runeId
      if (!runeId) continue
      const arr = refMap.get(runeId) ?? []
      arr.push({ slot, index: i })
      refMap.set(runeId, arr)
    }
  }
  return refMap
}

/**
 * 全局拓扑对账（loadGame / 事务前的防御性收口）：
 *   - 悬空引用（runeId 不在 inventory）→ 清空该位置
 *   - 重复引用（同一 runeId 出现在多个装备位置）→ 所有重复位置全部清空（不按遍历顺序选第一个）
 * 结果与装备/槽位遍历顺序无关。不修改 inventory、不抛异常。
 */
export function reconcileRuneReferences(
  equipmentBySlot: Partial<Record<EquipmentSlot, Equipment>>,
  inventory: Rune[]
): void {
  const invIds = new Set(inventory.map(r => r.id))
  const refMap = scanRuneReferences(equipmentBySlot)
  for (const [runeId, refs] of refMap) {
    const dangling = !invIds.has(runeId)
    const duplicate = refs.length > 1
    if (!dangling && !duplicate) continue
    // 悬空或重复：所有相关位置全部清空（不保留部分引用）
    for (const ref of refs) {
      const eq = equipmentBySlot[ref.slot]
      if (eq && eq.runeSlots[ref.index]) {
        eq.runeSlots[ref.index] = { index: ref.index, runeId: null }
      }
    }
  }
}

// ----------------------------- 纯镶嵌 / 移除规划 -----------------------------

export interface RuneSlotUpdate {
  equipmentSlot: EquipmentSlot
  slotIndex: number
  newRuneId: string | null
}

export interface PlanEmbedInput {
  targetEquipment: Equipment
  slotIndex: number
  runeId: string
  inventory: Rune[]
  equipmentBySlot: Partial<Record<EquipmentSlot, Equipment>>
}

export type EmbedRunePlan =
  | { ok: true; runeId: string; slotUpdates: RuneSlotUpdate[] }
  | { ok: false; reason: string }

export interface PlanRemoveInput {
  targetEquipment: Equipment
  slotIndex: number
  inventory: Rune[]
  equipmentBySlot: Partial<Record<EquipmentSlot, Equipment>>
}

export type RemoveRunePlan =
  | { ok: true; slotUpdates: RuneSlotUpdate[] }
  | { ok: false; reason: string }

/**
 * 纯规划：把 runeId 镶嵌到 targetEquipment 的 slotIndex。
 * 不修改任何输入。返回判别联合。
 *
 * 语义：
 *   - Rune 未镶嵌 → 放入目标位置
 *   - Rune 已镶嵌于其他装备 → 原位置清空 + 原子移动到目标
 *   - 目标位置已有另一 Rune → 原 Rune 自动变为未镶嵌（目标被覆盖）
 *   - Rune 已在目标同一位置 → no-op 失败（不写盘）
 * 当前全局拓扑若存在悬空或重复引用 → fail-closed（不应在运行时发生，属防御性收口）。
 */
export function planEmbedEquipmentRune(input: PlanEmbedInput): EmbedRunePlan {
  const { targetEquipment, slotIndex, runeId, inventory, equipmentBySlot } = input

  const econ = validateEquipmentForEconomy(targetEquipment)
  if (!econ.ok) return { ok: false, reason: `equipment invalid: ${econ.reason}` }

  const slots = validateEquipmentRuneSlots(targetEquipment)
  if (!slots.ok) return { ok: false, reason: `equipment runeSlots invalid: ${slots.reason}` }

  if (
    typeof slotIndex !== 'number' || !Number.isFinite(slotIndex) ||
    !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= EQUIPMENT_RUNE_SLOT_COUNT
  ) {
    return { ok: false, reason: 'slotIndex must be a finite integer 0..2' }
  }

  const inv = validateRuneInventory(inventory)
  if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

  const rune = inv.inventory.find(r => r.id === runeId)
  if (!rune) return { ok: false, reason: 'rune not found in inventory' }

  // 当前全局引用拓扑必须无悬空 / 无重复
  const refMap = scanRuneReferences(equipmentBySlot)
  for (const [rid, refs] of refMap) {
    if (refs.length > 1) return { ok: false, reason: 'duplicate rune reference in topology' }
    if (!inv.inventory.some(r => r.id === rid)) return { ok: false, reason: 'dangling rune reference in topology' }
  }

  // no-op：Rune 已在目标同一位置
  if (targetEquipment.runeSlots[slotIndex].runeId === runeId) {
    return { ok: false, reason: 'rune already embedded at target slot' }
  }

  const updates: RuneSlotUpdate[] = [
    { equipmentSlot: targetEquipment.slot, slotIndex, newRuneId: runeId }
  ]

  // 若 Rune 当前镶嵌于其他装备位置，原位置清空（原子移动）
  const current = refMap.get(runeId)
  if (current && current.length === 1) {
    const src = current[0]
    if (src.slot !== targetEquipment.slot || src.index !== slotIndex) {
      updates.push({ equipmentSlot: src.slot, slotIndex: src.index, newRuneId: null })
    }
  }

  return { ok: true, runeId, slotUpdates: updates }
}

/**
 * 纯规划：从 targetEquipment 的 slotIndex 移除符文。
 * 不修改任何输入。空槽 → no-op 失败；存在合法 Rune → 清空装备槽位（Rune 回到未镶嵌）；
 * 悬空 / 重复 / 损坏拓扑 → fail-closed。
 */
export function planRemoveEquipmentRune(input: PlanRemoveInput): RemoveRunePlan {
  const { targetEquipment, slotIndex, inventory, equipmentBySlot } = input

  const econ = validateEquipmentForEconomy(targetEquipment)
  if (!econ.ok) return { ok: false, reason: `equipment invalid: ${econ.reason}` }

  const slots = validateEquipmentRuneSlots(targetEquipment)
  if (!slots.ok) return { ok: false, reason: `equipment runeSlots invalid: ${slots.reason}` }

  if (
    typeof slotIndex !== 'number' || !Number.isFinite(slotIndex) ||
    !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= EQUIPMENT_RUNE_SLOT_COUNT
  ) {
    return { ok: false, reason: 'slotIndex must be a finite integer 0..2' }
  }

  const currentRuneId = targetEquipment.runeSlots[slotIndex].runeId
  if (!currentRuneId) return { ok: false, reason: 'slot is empty' }

  const inv = validateRuneInventory(inventory)
  if (!inv.ok) return { ok: false, reason: `inventory invalid: ${inv.reason}` }

  // 防御性：当前拓扑不应有悬空 / 重复
  const refMap = scanRuneReferences(equipmentBySlot)
  for (const [rid, refs] of refMap) {
    if (refs.length > 1) return { ok: false, reason: 'duplicate rune reference in topology' }
    if (!inv.inventory.some(r => r.id === rid)) return { ok: false, reason: 'dangling rune reference in topology' }
  }

  return {
    ok: true,
    slotUpdates: [{ equipmentSlot: targetEquipment.slot, slotIndex, newRuneId: null }]
  }
}

// ----------------------------- 符文属性读取（真实进入总属性） -----------------------------

/**
 * 计算一件装备的合法符文属性加成（flat StatBonus[]）。
 *   - 校验 inventory 与装备三孔；损坏 / 悬空 / 同装备重复引用 → 返回 []（fail-closed）
 *   - 不注入 NaN / Infinity / 负数
 *   - 通过 RUNE_TYPE_TO_STAT 映射，使用 getRuneEffectiveValue 公式
 * 不修改任何输入。
 */
export function getEquipmentRuneBonuses(equipment: unknown, inventory: unknown): StatBonus[] {
  const inv = validateRuneInventory(inventory)
  if (!inv.ok) return []

  const slots = validateEquipmentRuneSlots(equipment)
  if (!slots.ok) return []

  const invById = new Map(inv.inventory.map(r => [r.id, r] as const))
  const seen = new Set<string>()
  const bonuses: StatBonus[] = []

  for (const slot of slots.slots) {
    const runeId = slot.runeId
    if (!runeId) continue
    // 同装备重复引用 → 整体 fail-closed，不产生任何属性
    if (seen.has(runeId)) return []
    seen.add(runeId)
    const rune = invById.get(runeId)
    // 悬空引用 → fail-closed，不产生属性
    if (!rune) return []
    const stat = RUNE_TYPE_TO_STAT[rune.type] as StatType | undefined
    if (!stat) return []
    const value = getRuneEffectiveValue(rune.statValue, rune.level)
    if (!Number.isFinite(value) || value < 0) return []
    bonuses.push({ type: stat, value, isPercent: false })
  }

  return bonuses
}
