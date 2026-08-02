// @vitest-environment jsdom
/**
 * Phase 3.31 — TabsContainer 路由级异步加载（降低首屏主 chunk，产品行为不变）
 *
 * A. 架构护栏（readFileSync + stripComments）：
 *    - TabsContainer 导入 defineAsyncComponent；
 *    - BattleTab 仍为静态 import（应用外壳 / 默认战斗路径）；
 *    - 21 个非首屏 tab 均不再使用静态 import；
 *    - 21 个非首屏 tab 均经 defineAsyncComponent(() => import(...)) 注册；
 *    - 模板现有 route 分支与组件名保持存在；
 *    - navigation route ID（primary/secondary）未被修改。
 *
 * B. 行为测试（jsdom + mount + flushPromises）：
 *    - 默认 adventure/main 正常渲染 BattleTab；
 *    - 切 build/runes → 异步 RuneInventoryTab 真实动态加载完成；
 *    - 切 growth/stats → 异步 RoleTab 真实动态加载完成；
 *    - 切 resources/shopGacha → GachaTab、ShopTab、MerchantTab 均渲染
 *      （组合页完整显示，真实动态 import 解析，不全部 stub）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
// @ts-ignore
import { existsSync, readFileSync } from 'node:fs'
// @ts-ignore
import { resolve } from 'node:path'
// @ts-ignore
declare const process: { cwd(): string }
import { usePlayerStore } from '../stores/playerStore'
import { useNavigationStore } from '../stores/navigationStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGachaStore } from '../stores/gachaStore'
import { useMerchantStore } from '../stores/merchantStore'
import { useGameStore } from '../stores/gameStore'
import { useTrainingStore } from '../stores/trainingStore'
import { useCultivationStore } from '../stores/cultivationStore'
import { useTitleStore } from '../stores/titleStore'
import { usePetStore } from '../stores/petStore'
import { useRebirthStore } from '../stores/rebirthStore'
import { useTalentStore } from '../stores/talentStore'
import { useBattlePassStore } from '../stores/battlePassStore'
import { useCollectionStore } from '../stores/collectionStore'
import TabsContainer from '../components/TabsContainer.vue'

// ============================================================================
// A. 架构护栏
// ============================================================================
const ROOT = process.cwd()
const TAB_PATH = resolve(ROOT, 'src/components/TabsContainer.vue')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
}

const SRC = stripComments(readFileSync(TAB_PATH, 'utf8'))

const ASYNC_TABS = [
  'RoleTab',
  'SkillsTab',
  'ShopTab',
  'CultivationTab',
  'SigninTab',
  'BossRushTab',
  'PetTab',
  'AchievementStoryTab',
  'WorldBossTab',
  'InheritanceTab',
  'MerchantTab',
  'DungeonTab',
  'AdventureTab',
  'GachaTab',
  'MonopolyTab',
  'SeasonTab',
  'BattlePassTab',
  'AchievementTab',
  'BuildBonusTab',
  'AutoBuildTab',
  'RuneInventoryTab'
] as const

describe('Phase 3.31 架构护栏 — TabsContainer 代码拆分', () => {
  it('TabsContainer 导入 defineAsyncComponent', () => {
    expect(existsSync(TAB_PATH), 'TabsContainer.vue 应存在').toBe(true)
    expect(SRC).toMatch(/import \{[^}]*defineAsyncComponent[^}]*\} from 'vue'/)
  })

  it('BattleTab 仍为静态 import（默认战斗路径保留在首屏依赖图）', () => {
    expect(SRC).toMatch(/import BattleTab from '\.\/BattleTab\.vue'/)
  })

  it('21 个非首屏 tab 均不再使用静态 import', () => {
    for (const name of ASYNC_TABS) {
      expect(SRC, `${name} 不应再有静态 import`).not.toMatch(
        new RegExp(`import ${name} from '\\./${name}\\.vue'`)
      )
    }
  })

  it('21 个非首屏 tab 均经 defineAsyncComponent + 动态 import 注册', () => {
    for (const name of ASYNC_TABS) {
      expect(SRC, `${name} 应为异步组件`).toMatch(
        new RegExp(`const ${name} = defineAsyncComponent\\(\\(\\) => import\\('\\./${name}\\.vue'\\)\\)`)
      )
    }
  })

  it('模板现有 route 分支与组件名保持存在', () => {
    expect(SRC).toMatch(/nav\.route\.secondary === 'main' \|\| nav\.route\.secondary === 'training'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'autoBuild'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'equipment'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'runes'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'skills'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'stats'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'cultivation'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'pet'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'dungeon'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'bossRush'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'worldEvent'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'signinOffline'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'shopGacha'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'monopoly'/)
    expect(SRC).toMatch(/nav\.route\.secondary === 'seasonPass'/)
  })

  it('不修改 navigation route ID（primary/secondary 保持）', () => {
    // resources 由模板 v-else 兜底分支承载（不字面出现），故不在列表内
    for (const id of [
      'adventure',
      'build',
      'growth',
      'challenge',
      'main',
      'training',
      'autoBuild',
      'equipment',
      'runes',
      'skills',
      'stats',
      'cultivation',
      'pet',
      'dungeon',
      'bossRush',
      'worldEvent',
      'signinOffline',
      'shopGacha',
      'monopoly',
      'seasonPass'
    ]) {
      expect(SRC, `route id ${id} 应保留`).toMatch(new RegExp(`'${id}'`))
    }
  })
})

// ============================================================================
// B. 行为测试（异步组件真实加载）
// ============================================================================
function warmupStores() {
  usePlayerStore()
  useNavigationStore()
  useMonsterStore()
  useGachaStore()
  useMerchantStore()
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

function mountTab() {
  return mount(TabsContainer, {
    props: {
      battleMode: 'main',
      isDebugMode: false,
      debugStats: { totalDamage: 0, critCount: 0, killCount: 0, damageByType: {}, startTime: 0 },
      debugLog: []
    },
    global: {
      // BattleTab 是同步战斗页（含战斗循环副作用），行为测试 stub 它；
      // 异步 tab（RuneInventoryTab / RoleTab / GachaTab / ShopTab / MerchantTab）
      // 均真实渲染，验证真实动态 import 能解析。
      stubs: { BattleTab: true }
    }
  })
}

describe('Phase 3.31 行为 — TabsContainer 异步页面加载', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    warmupStores()
    // 解锁全部 primary / secondary（difficultyValue ≥ 200）
    const monster = useMonsterStore()
    monster.difficultyValue = 200
  })

  it('默认 adventure/main 正常渲染 BattleTab', async () => {
    const wrapper = mountTab()
    await nextTick()
    expect(wrapper.findComponent({ name: 'BattleTab' }).exists()).toBe(true)
  })

  it('切换到 build/runes：异步 RuneInventoryTab 真实动态加载完成', async () => {
    const wrapper = mountTab()
    const nav = useNavigationStore()
    nav.selectPrimary('build')
    nav.selectSecondary('runes')
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(wrapper.text()).toContain('尚未获得符文')
  })

  it('切换到 growth/stats：异步 RoleTab 真实动态加载完成', async () => {
    const wrapper = mountTab()
    const nav = useNavigationStore()
    nav.selectPrimary('growth')
    nav.selectSecondary('stats')
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    expect(wrapper.text()).toContain('角色属性')
  })

  it('切换到 resources/shopGacha：GachaTab、ShopTab、MerchantTab 均加载（组合页完整显示）', async () => {
    const wrapper = mountTab()
    const nav = useNavigationStore()
    nav.selectPrimary('resources')
    nav.selectSecondary('shopGacha')
    await flushPromises()
    await vi.dynamicImportSettled()
    await nextTick()
    const text = wrapper.text()
    expect(text).toContain('抽卡') // GachaTab
    expect(text).toContain('返回10层') // ShopTab
    expect(text).toContain('神秘商人') // MerchantTab
  })
})
