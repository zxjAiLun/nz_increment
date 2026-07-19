// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RoleTab from './RoleTab.vue'
import { usePlayerStore } from '../stores/playerStore'

/**
 * Phase 2.1.1 任务6：RoleTab 组件测试。
 * 验证只有配置中的五项属性渲染强化按钮，未配置属性（critRate/luck 等）只显示数值与解锁信息，
 * 不渲染 +0 / Infinity / 禁用的伪强化按钮；按钮文本展示「+effectPerLevel (cost) xN」；
 * 点击按钮实际扣款与展示价格一致。
 */
describe('RoleTab stat upgrade UI (Phase 2.1.1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function getUpgradeButton(wrapper: ReturnType<typeof mount>, statName: string) {
    const rows = wrapper.findAll('.stat-row')
    for (const row of rows) {
      const nameEl = row.find('.stat-name')
      if (nameEl.exists() && nameEl.text() === statName) {
        const btn = row.find('.upgrade-btn')
        return btn.exists() ? btn : null
      }
    }
    return null
  }

  it('attack row shows +2 and real cost (10)', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    const wrapper = mount(RoleTab)
    const btn = getUpgradeButton(wrapper, '攻击力')
    expect(btn).not.toBeNull()
    expect(btn!.text()).toContain('+2')
    expect(btn!.text()).toContain('10')
  })

  it('maxHp row shows +20', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    const wrapper = mount(RoleTab)
    const btn = getUpgradeButton(wrapper, '最大生命')
    expect(btn).not.toBeNull()
    expect(btn!.text()).toContain('+20')
  })

  it('penetration shows +5 and 50 only after unlock', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.unlockedPhases = [1, 2, 3]
    const wrapper = mount(RoleTab)
    const btn = getUpgradeButton(wrapper, '穿透')
    expect(btn).not.toBeNull()
    expect(btn!.text()).toContain('+5')
    expect(btn!.text()).toContain('50')
  })

  it('unconfigured stats (critRate/luck) do NOT render upgrade buttons', () => {
    const store = usePlayerStore()
    store.player.gold = 1000
    store.player.unlockedPhases = [1, 2, 3]
    const wrapper = mount(RoleTab)
    expect(getUpgradeButton(wrapper, '暴击率')).toBeNull()
    expect(getUpgradeButton(wrapper, '幸运')).toBeNull()
  })

  it('clicking attack button deducts gold by the displayed cost', () => {
    const store = usePlayerStore()
    store.player.gold = 100
    const wrapper = mount(RoleTab)
    const btn = getUpgradeButton(wrapper, '攻击力')!
    const cost = store.getUpgradeCost('attack') // 10
    expect(btn.text()).toContain(String(cost))
    btn.trigger('click')
    expect(store.player.gold).toBe(100 - cost)
    expect(store.statUpgradeCounts.get('attack')).toBe(1)
  })
})
