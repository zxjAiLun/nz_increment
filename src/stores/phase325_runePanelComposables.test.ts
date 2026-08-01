// @ts-ignore
import { existsSync, readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useRuneInventoryController } from '../composables/useRuneInventoryController'
import { useRuneEmbedPanel } from '../composables/useRuneEmbedPanel'
import { useRuneFeedPanel } from '../composables/useRuneFeedPanel'
import { useRuneBatchLockPanel } from '../composables/useRuneBatchLockPanel'
import type { RuneBatchFeedingTransactionResult, RuneBatchLockTransactionResult } from '../stores/playerStore'
import type { RuneInventoryRow, RuneInventoryViewResult } from '../utils/runeInventoryView'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.25 架构护栏：useRuneInventoryController 面板逻辑拆分（无行为变化）。
 *
 * 钉住：
 * - 三个面板子 composable 文件存在且被顶层 controller 接入；
 * - 顶层 controller 不再包含三个面板的大段具体实现（内部状态 ref / planner 预览 / 失效 watch）；
 * - 面板互斥由顶层协调：公开 openPicker / openFeedPanel / openBatchLockPanel 先关其他面板
 *   再调子模块内部 openPanel；子 composable 之间不互相 import（互斥不放进子模块相互调用）；
 * - 顶层 controller 对模板暴露的原有 40 个成员全部保留（运行时冒烟）；
 * - 三个子 composable 各自冒烟（stub context）返回其面板成员。
 *
 * 行为等价由 Phase 3.10–3.24 既有 Rune UI 测试套件保证（全量跑）。
 */
const ROOT = process.cwd()
const CONTROLLER_PATH = resolve(ROOT, 'src/composables/useRuneInventoryController.ts')
const EMBED_PATH = resolve(ROOT, 'src/composables/useRuneEmbedPanel.ts')
const FEED_PATH = resolve(ROOT, 'src/composables/useRuneFeedPanel.ts')
const BATCH_LOCK_PATH = resolve(ROOT, 'src/composables/useRuneBatchLockPanel.ts')

function readOrFail(path: string): string {
  expect(existsSync(path), `文件应存在: ${path}`).toBe(true)
  return readFileSync(path, 'utf8')
}

/** 去掉块/行注释，避免注释文字误报（沿用 phase316 手法）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
}

const CONTROLLER_SRC = stripComments(readOrFail(CONTROLLER_PATH))

describe('Phase 3.25: RuneInventoryController 面板拆分架构护栏', () => {
  it('三个面板子 composable 文件存在', () => {
    for (const p of [EMBED_PATH, FEED_PATH, BATCH_LOCK_PATH]) {
      expect(existsSync(p), `应存在 ${p}`).toBe(true)
    }
  })

  it('顶层 controller 已 import 并实例化三个子 composable', () => {
    for (const name of ['useRuneEmbedPanel', 'useRuneFeedPanel', 'useRuneBatchLockPanel']) {
      expect(CONTROLLER_SRC, `controller 应 import ${name}`).toMatch(
        new RegExp(`import\\s*\\{[^}]*${name}[^}]*\\}\\s*from\\s*['"]./useRune`)
      )
      expect(CONTROLLER_SRC, `controller 应调用 ${name}`).toMatch(
        new RegExp(`${name}\\(\\{`)
      )
    }
  })

  it('顶层 controller 不再包含面板内部状态 / planner 预览 / 失效 watch 实现', () => {
    // 面板内部状态 ref 声明
    expect(CONTROLLER_SRC).not.toMatch(/const pickerRuneId\s*=\s*ref\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const feedTargetRuneId\s*=\s*ref\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const feedMaterialRuneIds\s*=\s*ref\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const showFeedPanel\s*=\s*ref\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const showBatchLockPanel\s*=\s*ref\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const batchLockDesiredState\s*=\s*ref\(/)
    // planner 预览（面板内部实现）
    expect(CONTROLLER_SRC).not.toMatch(/planRuneBatchFeeding|planRuneBatchLockChange/)
    // 失效 watch（面板失效逻辑）
    expect(CONTROLLER_SRC).not.toMatch(/\bwatch\(/)
    // 面板专用派生（已下沉）
    expect(CONTROLLER_SRC).not.toMatch(/const equippedTargets\s*=\s*computed\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const feedCandidates\s*=\s*computed\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const batchLockCandidates\s*=\s*computed\(/)
    expect(CONTROLLER_SRC).not.toMatch(/const batchLockPreview\s*=\s*computed\(/)
  })

  it('面板互斥由顶层协调：公开 open 先关其他面板再调子模块内部 openPanel', () => {
    // openPicker：关 batchLock → 开 embed
    expect(CONTROLLER_SRC).toMatch(/function openPicker\(runeId: string\) \{\s*batchLockPanel\.closePanel\(\)\s*embedPanel\.openPanel\(runeId\)\s*\}/)
    // openFeedPanel：关 batchLock → 开 feed
    expect(CONTROLLER_SRC).toMatch(/function openFeedPanel\(runeId: string\) \{\s*batchLockPanel\.closePanel\(\)\s*feedPanel\.openPanel\(runeId\)\s*\}/)
    // openBatchLockPanel：关 embed + feed → 开 batchLock
    expect(CONTROLLER_SRC).toMatch(/function openBatchLockPanel\(\) \{\s*embedPanel\.closePanel\(\)\s*feedPanel\.closePanel\(\)\s*batchLockPanel\.openPanel\(\)\s*\}/)
  })

  it('子 composable 之间不互相 import（互斥不放进子模块相互调用）', () => {
    const embed = stripComments(readOrFail(EMBED_PATH))
    const feed = stripComments(readOrFail(FEED_PATH))
    const batchLock = stripComments(readOrFail(BATCH_LOCK_PATH))
    // 不 import 任何 ./useRune* 相对模块（其他面板子 composable）；共享类型只走 ./runePanelTypes
    expect(embed).not.toMatch(/from\s*['"]\.\/useRune/)
    expect(feed).not.toMatch(/from\s*['"]\.\/useRune/)
    expect(batchLock).not.toMatch(/from\s*['"]\.\/useRune/)
    // 各子 composable 暴露内部 openPanel（供顶层 wrapper 调用）
    for (const src of [embed, feed, batchLock]) {
      expect(src).toMatch(/openPanel/)
      expect(src).toMatch(/closePanel/)
    }
  })

  it('顶层 controller 保留原有 40 个模板成员（运行时冒烟）', () => {
    setActivePinia(createPinia())
    const controller = useRuneInventoryController()
    const expectedKeys = [
      // 状态
      'filter', 'sortKey', 'feedback', 'showPicker', 'feedMaterialRuneIds',
      'showFeedPanel', 'showBatchLockPanel', 'batchLockRuneIds', 'batchLockDesiredState',
      // 视图派生
      'isBroken', 'rows', 'sorted', 'summary', 'isDefaultFilterSort', 'equippedTargets',
      'pickerRune', 'feedTarget', 'feedCandidates', 'feedSelectionSummary',
      'feedPreviewModel', 'batchLockCandidates', 'batchLockPreview', 'batchLockChangedNames',
      // 事件 / 动作
      'resetFilterSort', 'openPicker', 'closePicker', 'confirmEmbed', 'confirmRemove',
      'toggleLock', 'openFeedPanel', 'closeFeedPanel', 'toggleFeedMaterial', 'confirmFeed',
      'openBatchLockPanel', 'closeBatchLockPanel', 'toggleBatchLockRune', 'confirmBatchLock',
      // 展示辅助
      'statNames', 'slotNames', 'feedExp'
    ]
    expect(expectedKeys).toHaveLength(40)
    for (const key of expectedKeys) {
      expect(controller, `controller 应导出 ${key}`).toHaveProperty(key)
    }
    // 互斥 wrapper 仍为函数
    for (const fn of ['openPicker', 'openFeedPanel', 'openBatchLockPanel']) {
      expect(typeof controller[fn as keyof typeof controller]).toBe('function')
    }
  })

  it('三个子 composable 各自冒烟（stub context）返回面板成员', () => {
    const feedback = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
    const view = computed(() => ({ ok: true, rows: [], targets: [] }) as RuneInventoryViewResult)
    const rows = computed(() => [] as RuneInventoryRow[])

    const embed = useRuneEmbedPanel({
      playerStore: { tryEmbedEquipmentRune: vi.fn(() => ({ ok: true })) },
      view,
      rows,
      feedback
    })
    for (const key of ['showPicker', 'pickerRune', 'equippedTargets', 'openPanel', 'closePanel', 'confirmEmbed']) {
      expect(embed, `embed 应导出 ${key}`).toHaveProperty(key)
    }

    const feed = useRuneFeedPanel({
      playerStore: {
        runeInventory: [],
        player: { equipment: {} },
        tryFeedRunes: vi.fn((): RuneBatchFeedingTransactionResult => ({
          ok: false,
          reason: 'stub',
          expAdded: 0,
          levelsGained: 0,
          materialsConsumed: 0,
          consumedRuneIds: []
        }))
      },
      view,
      rows,
      feedback
    })
    for (const key of ['showFeedPanel', 'feedTarget', 'feedCandidates', 'feedMaterialRuneIds', 'feedSelectionSummary', 'feedPreviewModel', 'openPanel', 'closePanel', 'toggleMaterial', 'confirmFeed']) {
      expect(feed, `feed 应导出 ${key}`).toHaveProperty(key)
    }

    const batchLock = useRuneBatchLockPanel({
      playerStore: {
        trySetRunesLocked: vi.fn((): RuneBatchLockTransactionResult => ({
          ok: false,
          reason: 'stub',
          selectedCount: 0,
          changedCount: 0,
          unchangedCount: 0,
          changedRuneIds: [],
          unchangedRuneIds: []
        }))
      },
      view,
      rows,
      feedback
    })
    for (const key of ['showBatchLockPanel', 'batchLockRuneIds', 'batchLockDesiredState', 'batchLockCandidates', 'batchLockPreview', 'batchLockChangedNames', 'openPanel', 'closePanel', 'toggleRune', 'confirm']) {
      expect(batchLock, `batchLock 应导出 ${key}`).toHaveProperty(key)
    }
  })
})
