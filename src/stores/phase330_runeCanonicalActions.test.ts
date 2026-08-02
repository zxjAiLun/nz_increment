// @ts-ignore
import { existsSync, readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.30 架构护栏：Rune 单卡操作（confirmRemove / toggleLock）canonical-source 契约。
 *
 * 钉住（readFileSync + stripComments，只检查结构性事实，不复制实现）：
 * - confirmRemove：从 rows.value 按 row.rune.id 解析 canonical current row、校验 current
 *   binding、事务用 currentBinding、成功反馈用 currentRow.displayName；禁止直接使用
 *   row.binding 作事务参数、禁止用 row.displayName 生成成功反馈；
 * - toggleLock：解析 canonical current row、存在 currentRow.isLocked !== row.isLocked 的
 *   stale guard、事务用 currentRow.rune.id、目标状态用 !currentRow.isLocked、成功与幂等
 *   反馈用 currentRow.displayName；禁止 !row.isLocked、禁止用 row.displayName 生成反馈；
 * - controller 单卡操作不直接写 playerStore.runeInventory / Rune 字段 / saveGame /
 *   localStorage.setItem（写入一律交给 Store 事务）。
 *
 * 传入 row 仅是「用户点击时看到的预期状态快照」，当前 rows 才是事务事实来源。
 */
const ROOT = process.cwd()
const CONTROLLER_PATH = resolve(ROOT, 'src/composables/useRuneInventoryController.ts')

function readOrFail(path: string): string {
  expect(existsSync(path), `文件应存在: ${path}`).toBe(true)
  return readFileSync(path, 'utf8')
}

/** 去掉块/行注释，避免注释文字误报。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
}

const SRC = stripComments(readOrFail(CONTROLLER_PATH))

describe('Phase 3.30: Rune 单卡操作 canonical-source 架构护栏', () => {
  it('confirmRemove 以 canonical current row 为事实来源', () => {
    // 从 rows.value 按 row.rune.id 解析 current row
    expect(SRC).toMatch(/const currentRow = rows\.value\.find\(current => current\.rune\.id === row\.rune\.id\)/)
    // 校验 current binding
    expect(SRC).toMatch(/const currentBinding = currentRow\.binding/)
    expect(SRC).toMatch(/currentBinding\.equipmentSlot !== requestedBinding\.equipmentSlot/)
    expect(SRC).toMatch(/currentBinding\.runeSlotIndex !== requestedBinding\.runeSlotIndex/)
    // 事务参数使用 currentBinding
    expect(SRC).toMatch(/tryRemoveEquipmentRune\(currentBinding\.equipmentSlot, currentBinding\.runeSlotIndex\)/)
    // 成功反馈使用 currentRow.displayName
    expect(SRC).toMatch(/已移除：\$\{currentRow\.displayName\}/)
  })

  it('confirmRemove 禁止沿用传入 row 的过期信息', () => {
    // 禁止 row.binding 作为事务参数
    expect(SRC).not.toMatch(/tryRemoveEquipmentRune\(row\.binding/)
    // 禁止 row.displayName 生成成功反馈
    expect(SRC).not.toMatch(/已移除：\$\{row\.displayName\}/)
  })

  it('toggleLock 以 canonical current row 为事实来源', () => {
    // 从 rows.value 按 row.rune.id 解析 current row
    expect(SRC).toMatch(/const currentRow = rows\.value\.find\(current => current\.rune\.id === row\.rune\.id\)/)
    // stale lock-state guard
    expect(SRC).toMatch(/currentRow\.isLocked !== row\.isLocked/)
    // 事务使用 currentRow.rune.id 与 !currentRow.isLocked
    expect(SRC).toMatch(/trySetRuneLocked\(currentRow\.rune\.id, !currentRow\.isLocked\)/)
    // 成功与幂等反馈使用 currentRow.displayName
    expect(SRC).toMatch(/currentRow\.displayName/)
  })

  it('toggleLock 禁止沿用传入 row 的过期状态与名称', () => {
    // 禁止 !row.isLocked 作为目标状态
    expect(SRC).not.toMatch(/!row\.isLocked/)
    // 禁止 row.displayName 生成反馈
    expect(SRC).not.toMatch(/\$\{row\.displayName\}/)
    // 禁止以 row.isLocked 计算事务目标（trySetRuneLocked 参数不得出现 row.isLocked）
    expect(SRC).not.toMatch(/trySetRuneLocked\([^)]*row\.isLocked/)
  })

  it('controller 单卡操作不直接写库存 / Rune 字段 / 保存入口（写入一律交 Store 事务）', () => {
    // 不直接写 playerStore.runeInventory
    expect(SRC).not.toMatch(/playerStore\.runeInventory\s*=/)
    // 不直接写 Rune 字段（isLocked 赋值）
    expect(SRC).not.toMatch(/\.isLocked\s*=/)
    // 不直接调用 saveGame / localStorage.setItem
    expect(SRC).not.toMatch(/saveGame/)
    expect(SRC).not.toMatch(/localStorage\.setItem/)
    // 事务调用只出现 try* 形式（嵌入/移除/锁定）
    expect(SRC).toMatch(/playerStore\.tryRemoveEquipmentRune\(/)
    expect(SRC).toMatch(/playerStore\.trySetRuneLocked\(/)
  })
})
