// @vitest-environment jsdom
/**
 * Phase 3.23 — Rune 仓库筛选重置与匹配计数（显示 X / Y + 重置筛选与排序）
 *
 * 仅覆盖：
 *   A. 匹配计数 X / Y（默认 / 单维 / 组合 / 空匹配 / 空仓库；排序改变不影响 X/Y；
 *      Y = 合法仓库总数，与筛选无关）
 *   B. 重置按钮默认禁用 / 任一筛选或排序改变后启用 / 回到默认后恢复禁用
 *   C. 重置恢复全部默认值（四维 all + sortKey=inventory）与仓库顺序（inventoryIndex 升序）
 *   D. 重置不关闭 picker / 强化面板 / 批量锁定面板，不改动其中 canonical-ID 选择
 *   E. 筛选/排序/重置全程零 Store 事务、零 RNG、零存储写入
 *   F. 数据损坏 fail-closed：仅异常横幅，不显示计数与重置按钮
 *
 * 不修改生产事务 / planner / 筛选 / 排序 / balance 公式与报告；状态仅组件本地，
 * 不持久化、不进 Store/URL/存档/localStorage。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useCultivationStore } from './cultivationStore'
import { useTitleStore } from './titleStore'
import { usePetStore } from './petStore'
import { useRebirthStore } from './rebirthStore'
import { useTalentStore } from './talentStore'
import { useBattlePassStore } from './battlePassStore'
import { useCollectionStore } from './collectionStore'
import type { Rune } from './runeStore'
import RuneInventoryTab from '../components/RuneInventoryTab.vue'
import { createEmptyEquipmentRuneSlots } from '../utils/equipmentRunes'
import type { Equipment, EquipmentSlot, RuneSlot } from '../types'

const SLOT_A: EquipmentSlot = 'weapon'

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useCultivationStore()
  useTitleStore()
  usePetStore()
  useRebirthStore()
  useTalentStore()
  useBattlePassStore()
  useCollectionStore()
}

function makeRune(id: string, opts?: Partial<Omit<Rune, 'id'>>): Rune {
  const rune: Rune = {
    id,
    type: opts?.type ?? 'attack',
    rarity: opts?.rarity ?? 'common',
    level: opts?.level ?? 1,
    exp: opts?.exp ?? 0,
    statValue: opts?.statValue ?? 10
  }
  if (opts && 'isLocked' in opts) rune.isLocked = opts.isLocked
  return rune
}

function makeRuneEquip(id: string, slot: EquipmentSlot, opts?: { runeSlots?: RuneSlot[] }): Equipment {
  return {
    id,
    slot,
    name: id,
    rarity: 'common',
    level: 10,
    stats: [{ type: 'attack', value: 100, isPercent: false }],
    isLocked: false,
    affixes: [],
    refiningSlots: [],
    refiningLevel: 0,
    runeSlots: opts?.runeSlots ?? createEmptyEquipmentRuneSlots()
  }
}

function slotsWith(...runeIds: (string | null)[]): RuneSlot[] {
  const slots = createEmptyEquipmentRuneSlots()
  for (let i = 0; i < Math.min(3, runeIds.length); i++) {
    slots[i] = { index: i, runeId: runeIds[i] }
  }
  return slots
}

function findByAriaPrefix(wrapper: ReturnType<typeof mount>, prefix: string) {
  const buttons = wrapper.findAll('button')
  for (const btn of buttons) {
    const label = btn.attributes('aria-label')
    if (label && label.startsWith(prefix)) return btn
  }
  return null
}

/** 仓库卡片网格中当前可见的 Rune 名称（不含 picker / 强化面板 / 批量锁定面板内的名称）。 */
function gridNames(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.rune-card .rune-name').map(n => n.text())
}

const typeSelect = 'select[aria-label="按类型筛选"]'
const raritySelect = 'select[aria-label="按稀有度筛选"]'
const statusSelect = 'select[aria-label="按状态筛选"]'
const lockSelect = 'select[aria-label="按锁定状态筛选"]'
const sortSelect = 'select[aria-label="排序方式"]'
const matchCount = '.match-count'
const resetBtn = '重置筛选与排序'

/**
 * 标准夹具（5 枚，r3/r4 镶嵌在 weapon，其余未镶嵌）：
 *   r0 attack/common/未锁定    r1 attack/rare/已锁定
 *   r2 luck/common/未锁定      r3 crit/epic/未锁定（镶嵌）
 *   r4 luck/legend/已锁定（镶嵌）
 */
const STANDARD = (): Rune[] => [
  makeRune('r0', { type: 'attack', rarity: 'common', isLocked: false }),
  makeRune('r1', { type: 'attack', rarity: 'rare', isLocked: true }),
  makeRune('r2', { type: 'luck', rarity: 'common', isLocked: false }),
  makeRune('r3', { type: 'crit', rarity: 'epic', isLocked: false }),
  makeRune('r4', { type: 'luck', rarity: 'legend', isLocked: true })
]

function setupInventory(runes: Rune[], opts?: { embed?: boolean }) {
  const playerStore = usePlayerStore()
  playerStore.runeInventory = runes
  if (opts?.embed) {
    playerStore.player.equipment[SLOT_A] = makeRuneEquip('w1', SLOT_A, {
      runeSlots: slotsWith('r3', 'r4', null)
    })
  }
  return playerStore
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// A. 匹配计数 X / Y
// ============================================================================
describe('Phase 3.23 — 匹配计数 X / Y', () => {
  it('默认筛选排序：显示 5 / 5（Y=合法仓库总数），重置按钮禁用', async () => {
    setupInventory(STANDARD(), { embed: true })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    expect(wrapper.find(matchCount).text()).toBe('显示 5 / 5')
    expect(findByAriaPrefix(wrapper, resetBtn)!.attributes('disabled')).toBeDefined()
  })

  it('单维与组合筛选：X 随筛选变化、Y 恒为合法仓库总数；空匹配仍显示 X / Y', async () => {
    setupInventory(STANDARD(), { embed: true })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // type=attack → r0, r1
    await wrapper.find(typeSelect).setValue('attack')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 2 / 5')

    // + lock=locked → r1
    await wrapper.find(lockSelect).setValue('locked')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 1 / 5')

    // + rarity=legend → 空匹配
    await wrapper.find(raritySelect).setValue('legend')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 0 / 5')
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.find(matchCount).text()).toBe('显示 0 / 5')

    // status=embedded（独立维度）：r3, r4
    await wrapper.find(typeSelect).setValue('all')
    await wrapper.find(lockSelect).setValue('all')
    await wrapper.find(raritySelect).setValue('all')
    await wrapper.find(statusSelect).setValue('embedded')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 2 / 5')

    await wrapper.find(statusSelect).setValue('unequipped')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 3 / 5')
  })

  it('排序改变不影响 X/Y：X 只随筛选变化', async () => {
    setupInventory(STANDARD(), { embed: true })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 5 / 5')

    // rarity 排序（高优先，同级按 inventoryIndex）：r4 legend → r3 epic → r1 rare → r0, r2 common
    await wrapper.find(sortSelect).setValue('rarity')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 5 / 5')
    expect(gridNames(wrapper)).toEqual(['传说幸运符文', '史诗暴击符文', '稀有攻击符文', '普通攻击符文', '普通幸运符文'])

    // 筛选 + 排序组合：X 只反映筛选，不受排序影响
    await wrapper.find(typeSelect).setValue('luck')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 2 / 5')
    await wrapper.find(sortSelect).setValue('inventory')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 2 / 5')
    expect(gridNames(wrapper)).toEqual(['普通幸运符文', '传说幸运符文'])
  })

  it('空仓库：显示 0 / 0，按钮禁用', async () => {
    setupInventory([])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 0 / 0')
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(findByAriaPrefix(wrapper, resetBtn)!.attributes('disabled')).toBeDefined()
  })
})

// ============================================================================
// B. 重置按钮启用 / 禁用
// ============================================================================
describe('Phase 3.23 — 重置按钮启用 / 禁用', () => {
  it('默认禁用；任一筛选或排序改变后启用；回到默认后恢复禁用', async () => {
    setupInventory(STANDARD(), { embed: true })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()
    const reset = () => findByAriaPrefix(wrapper, resetBtn)!

    expect(reset().attributes('disabled')).toBeDefined()

    await wrapper.find(typeSelect).setValue('attack')
    await nextTick()
    expect(reset().attributes('disabled')).toBeUndefined()

    // 回到筛选默认值 → 按钮恢复禁用
    await wrapper.find(typeSelect).setValue('all')
    await nextTick()
    expect(reset().attributes('disabled')).toBeDefined()

    // 仅排序改变 → 启用
    await wrapper.find(sortSelect).setValue('level')
    await nextTick()
    expect(reset().attributes('disabled')).toBeUndefined()
  })
})

// ============================================================================
// C. 重置恢复全部默认值与仓库顺序
// ============================================================================
describe('Phase 3.23 — 重置恢复默认值', () => {
  it('四维筛选 + 排序全部重置为默认，仓库恢复 inventoryIndex 顺序，按钮恢复禁用', async () => {
    setupInventory(STANDARD(), { embed: true })
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(typeSelect).setValue('attack')
    await wrapper.find(raritySelect).setValue('common')
    await wrapper.find(lockSelect).setValue('locked')
    await wrapper.find(sortSelect).setValue('rarity')
    await nextTick()
    expect(wrapper.find(matchCount).text()).toBe('显示 0 / 5')
    expect(gridNames(wrapper)).toEqual([])
    expect(findByAriaPrefix(wrapper, resetBtn)!.attributes('disabled')).toBeUndefined()

    await findByAriaPrefix(wrapper, resetBtn)!.trigger('click')
    await nextTick()

    expect(wrapper.get<HTMLSelectElement>(typeSelect).element.value).toBe('all')
    expect(wrapper.get<HTMLSelectElement>(raritySelect).element.value).toBe('all')
    expect(wrapper.get<HTMLSelectElement>(statusSelect).element.value).toBe('all')
    expect(wrapper.get<HTMLSelectElement>(lockSelect).element.value).toBe('all')
    expect(wrapper.get<HTMLSelectElement>(sortSelect).element.value).toBe('inventory')
    expect(wrapper.find(matchCount).text()).toBe('显示 5 / 5')
    expect(gridNames(wrapper)).toEqual(['普通攻击符文', '稀有攻击符文', '普通幸运符文', '史诗暴击符文', '传说幸运符文'])
    expect(findByAriaPrefix(wrapper, resetBtn)!.attributes('disabled')).toBeDefined()
  })
})

// ============================================================================
// D. 重置不关闭面板、不改动 canonical-ID 选择
// ============================================================================
describe('Phase 3.23 — 重置后面板与选择身份保持', () => {
  it('picker 已打开：重置后保持打开、目标 Rune 身份不变、零事务', async () => {
    const playerStore = setupInventory(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryEmbedEquipmentRune')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 打开 r0（未镶嵌）的 picker
    await findByAriaPrefix(wrapper, '镶嵌或移动 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')

    // 改筛选（隐藏 r0）→ 重置 → picker 保持、身份保持
    await wrapper.find(typeSelect).setValue('luck')
    await nextTick()
    await findByAriaPrefix(wrapper, resetBtn)!.trigger('click')
    await nextTick()

    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(wrapper.find('.picker-head').text()).toContain('普通攻击符文')
    expect(spy).not.toHaveBeenCalled()
  })

  it('强化面板已打开且有材料选择：重置后面板保持、材料 canonical-ID 选择保持、预览不变、零事务', async () => {
    const playerStore = setupInventory(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'tryFeedRunes')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    // 打开 r0 强化面板（未镶嵌、Lv1/0exp/未锁定），唯一材料候选为 r2（未锁定、未镶嵌、Lv1/0exp）
    await findByAriaPrefix(wrapper, '强化 ')!.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    const mat = wrapper.find('.feed-materials button')
    expect(mat.exists()).toBe(true)
    await mat.trigger('click')
    await nextTick()
    expect(wrapper.find('.feed-materials button').attributes('data-selected')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')

    // 改筛选 + 排序 → 重置 → 面板保持、选择保持、预览可用
    await wrapper.find(lockSelect).setValue('locked')
    await wrapper.find(sortSelect).setValue('level')
    await nextTick()
    await findByAriaPrefix(wrapper, resetBtn)!.trigger('click')
    await nextTick()

    expect(wrapper.find('.feed-panel').exists()).toBe(true)
    expect(wrapper.find('.feed-materials button').attributes('data-selected')).toBe('true')
    expect(wrapper.find('.feed-selection-summary').text()).toContain('已选 1 枚')
    expect(wrapper.find('.feed-preview').exists()).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('批量锁定面板已打开且有选择：重置后面板保持、canonical-ID 选择保持、零事务', async () => {
    const playerStore = setupInventory(STANDARD(), { embed: true })
    const spy = vi.spyOn(playerStore, 'trySetRunesLocked')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await findByAriaPrefix(wrapper, '打开批量锁定管理')!.trigger('click')
    await nextTick()
    const list = () => wrapper.find('.batch-lock-list').findAll('button')
    expect(list().length).toBe(5) // 候选=完整合法仓库，不受外层筛选
    await list()[0].trigger('click') // r0
    await list()[2].trigger('click') // r2
    await nextTick()
    expect(list()[0].attributes('data-selected')).toBe('true')
    expect(list()[2].attributes('data-selected')).toBe('true')

    // 改筛选 → 重置 → 面板保持、选择保持
    await wrapper.find(lockSelect).setValue('locked')
    await wrapper.find(typeSelect).setValue('attack')
    await nextTick()
    await findByAriaPrefix(wrapper, resetBtn)!.trigger('click')
    await nextTick()

    expect(wrapper.find('.batch-lock-panel').exists()).toBe(true)
    expect(list()[0].attributes('data-selected')).toBe('true')
    expect(list()[2].attributes('data-selected')).toBe('true')
    expect(wrapper.find('.batch-lock-summary').text()).toContain('已选择 2 枚')
    expect(spy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// E. 零 Store 事务、零 RNG、零存储写入
// ============================================================================
describe('Phase 3.23 — 筛选/排序/重置零副作用', () => {
  it('全程不调用任何 Store 事务、不消耗 RNG、不写存储', async () => {
    const playerStore = setupInventory(STANDARD(), { embed: true })
    const txns = [
      vi.spyOn(playerStore, 'tryEmbedEquipmentRune'),
      vi.spyOn(playerStore, 'tryRemoveEquipmentRune'),
      vi.spyOn(playerStore, 'trySetRuneLocked'),
      vi.spyOn(playerStore, 'trySetRunesLocked'),
      vi.spyOn(playerStore, 'tryFeedRunes')
    ]
    const rngSpy = vi.spyOn(Math, 'random')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    await wrapper.find(typeSelect).setValue('attack')
    await wrapper.find(raritySelect).setValue('common')
    await wrapper.find(lockSelect).setValue('locked')
    await wrapper.find(sortSelect).setValue('rarity')
    await nextTick()
    await findByAriaPrefix(wrapper, resetBtn)!.trigger('click')
    await nextTick()

    for (const s of txns) expect(s).not.toHaveBeenCalled()
    expect(rngSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// F. 数据损坏 fail-closed
// ============================================================================
describe('Phase 3.23 — 损坏视图 fail-closed', () => {
  it('仅显示异常横幅；不渲染计数与重置按钮（筛选/排序区域整体不可见）', async () => {
    setupInventory([{ id: 'broken' } as unknown as Rune])
    const wrapper = mount(RuneInventoryTab)
    await nextTick()

    expect(wrapper.find('.broken-banner').exists()).toBe(true)
    expect(wrapper.find(matchCount).exists()).toBe(false)
    expect(findByAriaPrefix(wrapper, resetBtn)).toBeNull()
    expect(wrapper.find('.controls').exists()).toBe(false)
    expect(wrapper.find('.summary').exists()).toBe(false)
  })
})
