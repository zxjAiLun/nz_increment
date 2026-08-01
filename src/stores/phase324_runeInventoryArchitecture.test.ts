// @ts-ignore
import { existsSync, readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuneInventoryController } from '../composables/useRuneInventoryController'
// @ts-ignore
declare const process: { cwd(): string }

/**
 * Phase 3.24 架构护栏：RuneInventoryTab 结构拆分（无行为变化）。
 *
 * 钉住：
 * - .vue 物理行数 ≤ 400（项目规则）；
 * - .vue 不再直接包含 usePlayerStore / planner import / playerStore.try* 调用
 *   （仅限 <script setup> 块内扫描，排除模板注释干扰）；
 * - composable 与外部 scoped stylesheet 已接入；
 * - composable 冒烟：setActivePinia 后调用返回全部模板所需成员；
 * - 外部样式文件包含关键选择器；模板关键 aria-label / 类名与文案保留；
 * - 模板不再引用拆分前的旧常量/helper 名。
 *
 * 行为等价由 Phase 3.10–3.23 既有 Rune UI 测试套件保证（全量跑）。
 */
const ROOT = process.cwd()
const COMPONENT_PATH = resolve(ROOT, 'src/components/RuneInventoryTab.vue')
const COMPOSABLE_PATH = resolve(ROOT, 'src/composables/useRuneInventoryController.ts')
const STYLE_PATH = resolve(ROOT, 'src/styles/rune-inventory.css')

function readOrFail(path: string): string {
  expect(existsSync(path), `文件应存在: ${path}`).toBe(true)
  return readFileSync(path, 'utf8')
}

/** 提取 <script setup> 块（扫描范围限定于此，避免模板注释误报）。 */
function scriptBlock(src: string): string {
  const m = src.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)
  expect(m, '<script setup lang="ts"> 块应存在').toBeTruthy()
  return m![1]
}

/** 提取 <template> 根块（贪婪匹配到最后一个 </template>，避免内层 v-if/v-else <template> 提前截断）。 */
function templateBlock(src: string): string {
  const m = src.match(/<template>([\s\S]*)<\/template>/)
  expect(m, '<template> 根块应存在').toBeTruthy()
  return m![1]
}

describe('Phase 3.24: RuneInventoryTab 结构拆分架构护栏', () => {
  it('.vue 物理行数不超过 400（项目规则）', () => {
    const src = readOrFail(COMPONENT_PATH)
    const lines = src.split('\n').length
    expect(lines).toBeLessThanOrEqual(400)
  })

  it('.vue <script setup> 不再直接包含 usePlayerStore / planner import / playerStore.try*', () => {
    const script = scriptBlock(readOrFail(COMPONENT_PATH))
    // Store import
    expect(script).not.toMatch(/usePlayerStore/)
    expect(script).not.toMatch(/from\s+['"]\.\.\/stores\/playerStore/)
    // planner / helper import（任何 utils 导入都禁止，逻辑应全部在 composable）
    expect(script).not.toMatch(/from\s+['"]\.\.\/utils\//)
    // 事务调用
    expect(script).not.toMatch(/playerStore\.try[A-Z]/)
    expect(script).not.toMatch(/tryEmbedEquipmentRune|tryRemoveEquipmentRune|trySetRuneLocked|tryFeedRunes|trySetRunesLocked/)
  })

  it('.vue 已接入 composable 与外部 scoped stylesheet', () => {
    const src = readOrFail(COMPONENT_PATH)
    expect(src).toMatch(/import\s*\{\s*useRuneInventoryController\s*\}\s*from\s*['"]\.\.\/composables\/useRuneInventoryController/)
    expect(src).toMatch(/useRuneInventoryController\(\)/)
    expect(src).toMatch(/<style scoped src="\.\.\/styles\/rune-inventory\.css"><\/style>/)
  })

  it('composable 存在且冒烟返回模板所需的全部成员（零 RNG / 零写盘）', () => {
    expect(existsSync(COMPOSABLE_PATH), 'composable 文件应存在').toBe(true)
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
    for (const key of expectedKeys) {
      expect(controller, `composable 应导出 ${key}`).toHaveProperty(key)
    }
    // 展示辅助必须与纯常量/纯函数一致（证明组件侧只做了改名，无第二份公式）
    expect(controller.feedExp).toBeTypeOf('function')
    expect(typeof controller.statNames).toBe('object')
    expect(typeof controller.slotNames).toBe('object')
  })

  it('外部 scoped 样式文件存在且包含关键选择器', () => {
    const css = readOrFail(STYLE_PATH)
    for (const selector of [
      '.rune-inventory', '.summary', '.controls', '.filter-meta', '.match-count',
      '.reset-filter-sort', '.feedback', '.broken-banner', '.empty-state', '.rune-grid',
      '.rune-card', '.rune-actions', '.picker', '.feed-panel', '.feed-materials',
      '.feed-material', '.feed-selection-summary', '.feed-preview', '.batch-lock-entry',
      '.batch-lock-panel', '.batch-lock-list', '.batch-lock-item', '.batch-lock-summary'
    ]) {
      expect(css, `样式应包含 ${selector}`).toMatch(selector)
    }
  })

  it('模板关键 aria-label / 类名 / 按钮文案保留（DOM 契约不变）', () => {
    const template = templateBlock(readOrFail(COMPONENT_PATH))
    for (const label of [
      'aria-label="符文仓库"',
      'aria-label="符文仓库摘要"',
      'aria-label="按类型筛选"',
      'aria-label="按稀有度筛选"',
      'aria-label="按状态筛选"',
      'aria-label="按锁定状态筛选"',
      'aria-label="排序方式"',
      'aria-label="筛选匹配计数"',
      'aria-label="重置筛选与排序"',
      'aria-label="打开批量锁定管理"',
      'aria-label="选择镶嵌目标"',
      'aria-label="关闭镶嵌目标选择"',
      'aria-label="强化符文"',
      'aria-label="关闭强化面板"',
      'aria-label="强化材料候选"',
      'aria-label="已选材料摘要"',
      'aria-label="强化预览"',
      'aria-label="批量锁定符文"',
      'aria-label="关闭批量锁定管理"',
      'aria-label="选择批量锁定目标状态"',
      'aria-label="批量锁定候选符文"',
      'aria-label="批量锁定预览"'
    ]) {
      expect(template, `模板应保留 ${label}`).toMatch(label)
    }
    for (const className of ['rune-grid', 'rune-card', 'batch-lock-panel', 'feed-panel', 'picker', 'broken-banner']) {
      expect(template).toMatch(new RegExp(`class="${className}"`))
    }
    for (const text of ['重置筛选与排序', '批量设置锁定状态', '确认强化', '已满级', '尚未获得符文', '无匹配筛选结果']) {
      expect(template).toMatch(text)
    }
  })

  it('模板不再引用拆分前的旧常量 / helper 名（替换彻底）', () => {
    const template = templateBlock(readOrFail(COMPONENT_PATH))
    expect(template).not.toMatch(/STAT_NAMES/)
    expect(template).not.toMatch(/EQUIPMENT_SLOT_NAMES/)
    expect(template).not.toMatch(/getRuneFeedExperience/)
  })
})
