// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChallengeStore } from './challengeStore'
import { usePlayerStore } from './playerStore'
import * as playerStoreModule from './playerStore'
import { useTalentStore } from './talentStore'
import * as talentStoreModule from './talentStore'

/**
 * Phase 3.74 — Challenge 批量完成奖励补偿事务。
 *
 * - checkCompletion() 将一次调用中所有达标且未领取的 daily/weekly challenge 作为一个事务；
 * - 单一 timestamp（options.now 优先，缺省仅一次 Date.now；非法/抛错 → 空数组、零 mutation、零 storage）；
 * - 纯内存应用 gold(gold→battlepass exp) / diamond / exp（含 level-up → talent point），completed 标记；
 * - 固定持久化顺序 BattlePass → Talent → Player main(saveGame(ts)) → Daily → Weekly；
 * - 任一保存失败 → 内存回滚 + 逆序补偿已写入 raw；补偿失败抛 'challenge completion persistence rollback failed'；
 * - 不调用 persistful addGold()/addExperience()；claimReward() 只委托事务。
 */

const BATTLEPASS_KEY = 'nz_battlepass_v1'
const TALENT_KEY = 'nz_talent_tree_v2'
const MAIN_KEY = 'lollipop_adventure_save'
const DAILY_KEY = 'nz_daily_challenges_v1'
const WEEKLY_KEY = 'nz_weekly_challenges_v1'

const NOW = 1_700_000_000_000 // 合法正安全整数

function createStores() {
  setActivePinia(createPinia())
  const challenge = useChallengeStore()
  const player = usePlayerStore()
  const talent = useTalentStore()
  return { challenge, player, talent }
}

// 冷 Store：仅创建 ChallengeStore（其构造 load() 会写 daily/weekly raw，但 checkCompletion 调用本身不得触碰 storage / 依赖 Store）。
function createChallengeOnly() {
  setActivePinia(createPinia())
  const challenge = useChallengeStore()
  return { challenge }
}

// 将指定 challenge 标记为达标且未领取（progress 拉满、resetAt 推到真实未来、completed=false）。
// 使用真实未来时间戳：① 以 now:NOW 调用时 resetAt(真实未来) > NOW → 仍判定为未过期、合格；
// ② 重载（load 用真实 Date.now）时不会被判过期而重新生成，可验证 completed 持久化。
function markEligible(store: ReturnType<typeof useChallengeStore>, listName: 'daily' | 'weekly', index: number) {
  const list = listName === 'daily' ? store.dailyChallenges : store.weeklyChallenges
  const c = list[index]
  c.progress = c.target
  c.resetAt = Date.now() + 1_000_000_000
  c.completed = false
}

const originalSetItem = Storage.prototype.setItem

// 仅对 failKeys 抛出，其余 key 真实落盘（便于验证成功写入与补偿恢复）。
function armSetItemFail(failKeys: string[]) {
  const spy = vi.spyOn(Storage.prototype, 'setItem')
  spy.mockImplementation((key: string, value: string) => {
    if (failKeys.includes(key)) throw new Error('injected save failure')
    return originalSetItem.call(localStorage, key, value)
  })
  return spy
}

function armRemoveItemFail() {
  const spy = vi.spyOn(Storage.prototype, 'removeItem')
  spy.mockImplementation(() => {
    throw new Error('injected removeItem failure')
  })
  return spy
}

function challengeById(store: ReturnType<typeof useChallengeStore>, id: string) {
  return [...store.dailyChallenges, ...store.weeklyChallenges].find(c => c.id === id)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 3.74 — 单次时间与候选合同', () => {
  it('无 eligible challenge：空数组、零 storage 写盘', () => {
    const { challenge, player } = createStores()
    const goldBefore = player.player.gold
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('非法 now → 空数组', () => {
    const { challenge } = createStores()
    expect(challenge.checkCompletion({ now: 0 })).toEqual([])
    expect(challenge.checkCompletion({ now: -1 })).toEqual([])
    expect(challenge.checkCompletion({ now: NaN })).toEqual([])
    expect(challenge.checkCompletion({ now: 1.5 })).toEqual([])
  })

  it('Date.now() 抛错 → 空数组', () => {
    const { challenge } = createStores()
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clk') })
    expect(challenge.checkCompletion()).toEqual([])
  })

  it('缺省时间从 Date.now() 取单次 timestamp', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0) // gold challenge
    const spy = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const result = challenge.checkCompletion()
    // 事务 timestamp 取自 Date.now()（内部 save 辅助函数也可能调用 Date.now，故仅断言被调用）。
    expect(spy).toHaveBeenCalled()
    expect(result.length).toBe(1)
  })
})

describe('Phase 3.74 — 各类奖励成功', () => {
  it('单个 gold challenge 成功（gold + battlepass exp）', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold:1000
    const before = player.player.gold
    const beforeBp = player.battlePass.exp
    const result = challenge.checkCompletion({ now: NOW })
    expect(result.length).toBe(1)
    expect(player.player.gold).toBe(before + 1000)
    expect(player.battlePass.exp).toBe(beforeBp + Math.floor(1000 / 10))
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(true)
  })

  it('单个 diamond challenge 成功', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'weekly', 0) // diamond:50
    const before = player.player.diamond
    const result = challenge.checkCompletion({ now: NOW })
    expect(result.length).toBe(1)
    expect(player.player.diamond).toBe(before + 50)
    expect(challengeById(challenge, 'weekly_kill_1000')!.completed).toBe(true)
  })

  it('exp challenge 未升级（exp < expNeeded）', () => {
    const { challenge, player, talent } = createStores()
    // 把玩家推到高等级，使 500 exp 不足以升级
    player.player.level = 50
    markEligible(challenge, 'daily', 3) // exp:500
    const lvl = player.player.level
    const tp = talent.talentPoints
    challenge.checkCompletion({ now: NOW })
    expect(player.player.level).toBe(lvl)
    expect(talent.talentPoints).toBe(tp)
    expect(player.player.experience).toBeGreaterThan(0)
  })

  it('exp challenge 跨 level：验证 stats/maxHp/unlocked phase/talent point', () => {
    const { challenge, player, talent } = createStores()
    const startLevel = player.player.level
    const startTp = talent.talentPoints
    const startMaxHp = player.player.maxHp
    markEligible(challenge, 'daily', 3) // exp:500 → 至少升 1 级
    challenge.checkCompletion({ now: NOW })
    expect(player.player.level).toBeGreaterThan(startLevel)
    expect(talent.talentPoints).toBe(startTp + (player.player.level - startLevel))
    expect(player.player.maxHp).toBeGreaterThan(startMaxHp)
    expect(player.player.unlockedPhases.length).toBeGreaterThanOrEqual(1)
  })

  it('gold 与 exp 对 BattlePass 的累计语义', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold:1000 → bp += 100
    markEligible(challenge, 'daily', 3) // exp:500 → bp += 100
    const beforeBp = player.battlePass.exp
    challenge.checkCompletion({ now: NOW })
    expect(player.battlePass.exp).toBe(beforeBp + 100 + 100)
  })

  it('daily 与 weekly 同时达标，顺序和批量结果正确', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 1) // diamond:5
    markEligible(challenge, 'weekly', 0) // diamond:50
    const beforeDiamond = player.player.diamond
    const result = challenge.checkCompletion({ now: NOW })
    expect(result.length).toBe(2)
    expect(player.player.diamond).toBe(beforeDiamond + 5 + 50)
    expect(challengeById(challenge, 'daily_kill_100')!.completed).toBe(true)
    expect(challengeById(challenge, 'weekly_kill_1000')!.completed).toBe(true)
  })

  it('多条奖励每条恰好应用一次（不合并 floor）', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold:1000
    markEligible(challenge, 'daily', 2) // gold:2000
    const before = player.player.gold
    challenge.checkCompletion({ now: NOW })
    expect(player.player.gold).toBe(before + 1000 + 2000)
  })

  it('passive-only challenge 保持无 Player 数值发放语义', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'weekly', 2) // passive:1，无 gold/diamond/exp
    const beforeGold = player.player.gold
    const beforeDiamond = player.player.diamond
    const beforeExp = player.player.experience
    const result = challenge.checkCompletion({ now: NOW })
    expect(result.length).toBe(1)
    expect(player.player.gold).toBe(beforeGold)
    expect(player.player.diamond).toBe(beforeDiamond)
    expect(player.player.experience).toBe(beforeExp)
    expect(challengeById(challenge, 'weekly_training_500')!.completed).toBe(true)
  })
})

describe('Phase 3.74 — 第二次调用与幂等', () => {
  it('第二次调用零奖励、零写盘', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    const first = challenge.checkCompletion({ now: NOW })
    expect(first.length).toBe(1)
    const goldAfterFirst = player.player.gold
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const second = challenge.checkCompletion({ now: NOW })
    expect(second).toEqual([])
    expect(player.player.gold).toBe(goldAfterFirst)
    const challengeWrites = setItemSpy.mock.calls.filter(c => c[0] === DAILY_KEY || c[0] === WEEKLY_KEY)
    expect(challengeWrites.length).toBe(0)
  })
})

describe('Phase 3.74 — raw getItem 失败', () => {
  it('每个相关 raw getItem() 失败 → 返回 []、零 mutation、零写盘', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    markEligible(challenge, 'daily', 3)
    const goldBefore = player.player.gold
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage broken') })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.74 — 各失败点与补偿', () => {
  it('BattlePass 保存失败 → 回滚、空数组', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold → hasBattlePass
    const goldBefore = player.player.gold
    armSetItemFail([BATTLEPASS_KEY])
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
  })

  it('Talent 保存失败 → 回滚、空数组', () => {
    const { challenge, player, talent } = createStores()
    player.player.level = 1
    markEligible(challenge, 'daily', 3) // exp → 升级 → talent 改变
    const tpBefore = talent.talentPoints
    armSetItemFail([TALENT_KEY])
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(talent.talentPoints).toBe(tpBefore)
    expect(challengeById(challenge, 'daily_training_20')!.completed).toBe(false)
  })

  it('saveGame() 返回 false → 回滚、空数组', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold → hasPlayerMain
    const goldBefore = player.player.gold
    const saveSpy = vi.spyOn(player, 'saveGame').mockReturnValue(false)
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
    saveSpy.mockRestore()
  })

  it('saveGame() 抛错 → 回滚、空数组', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    const goldBefore = player.player.gold
    const saveSpy = vi.spyOn(player, 'saveGame').mockImplementation(() => { throw new Error('save boom') })
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
    saveSpy.mockRestore()
  })

  it('Daily 保存失败 → 回滚、空数组', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    const goldBefore = player.player.gold
    armSetItemFail([DAILY_KEY])
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(player.player.gold).toBe(goldBefore)
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
  })

  it('Weekly 保存失败并恢复 Daily raw', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0)
    // 预置一个非默认 daily raw，用于验证补偿将其还原。
    const seededDaily = JSON.stringify([{ id: 'seeded', name: 'x', completed: false }])
    localStorage.setItem(DAILY_KEY, seededDaily)
    armSetItemFail([WEEKLY_KEY])
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(localStorage.getItem(DAILY_KEY)).toBe(seededDaily)
  })

  it('原 raw 不存在时补偿使用 removeItem', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0)
    // createStores() 的 load() 会写盘 daily raw；显式移除使其 previous === null，
    // 从而触发补偿的 removeItem 分支。
    localStorage.removeItem(DAILY_KEY)
    armSetItemFail([WEEKLY_KEY])
    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(localStorage.getItem(DAILY_KEY)).toBeNull()
  })

  it('多 key 补偿中第一个恢复失败仍继续剩余恢复', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0) // gold → battlepass + main + daily 写入
    const seededBp = JSON.stringify({ level: 0, exp: 7, freeRewards: [], premiumRewards: [], purchased: false })
    localStorage.setItem(BATTLEPASS_KEY, seededBp)
    armSetItemFail([WEEKLY_KEY])
    armRemoveItemFail() // 补偿 daily（previous null）时 removeItem 抛错，但不阻断 battlepass 恢复
    expect(() => challenge.checkCompletion({ now: NOW })).toThrow('challenge completion persistence rollback failed')
    // 即便 removeItem 失败，battlepass 的补偿恢复仍执行
    expect(localStorage.getItem(BATTLEPASS_KEY)).toBe(seededBp)
  })

  it('补偿失败抛固定错误', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0)
    armSetItemFail([WEEKLY_KEY])
    armRemoveItemFail()
    expect(() => challenge.checkCompletion({ now: NOW })).toThrow('challenge completion persistence rollback failed')
  })
})

describe('Phase 3.74 — 失败点均恢复内存状态', () => {
  it('BattlePass 失败恢复 Player/BattlePass/Talent/Challenge', () => {
    const { challenge, player, talent } = createStores()
    player.player.level = 1
    markEligible(challenge, 'daily', 0) // gold
    markEligible(challenge, 'daily', 3) // exp → levelup → talent
    const goldBefore = player.player.gold
    const tpBefore = talent.talentPoints
    const bpExpBefore = player.battlePass.exp
    armSetItemFail([BATTLEPASS_KEY])
    challenge.checkCompletion({ now: NOW })
    expect(player.player.gold).toBe(goldBefore)
    expect(talent.talentPoints).toBe(tpBefore)
    expect(player.battlePass.exp).toBe(bpExpBefore)
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
    expect(challengeById(challenge, 'daily_training_20')!.completed).toBe(false)
  })
})

describe('Phase 3.74 — fresh success / failure 重载', () => {
  it('fresh success 重载保留 player/battlepass/talent/completed', () => {
    const { challenge, player, talent } = createStores()
    // level=2：expNeeded=300，exp 500 恰好跨越一个阈值 → 仅一次 level-up → talent+1。
    player.player.level = 2
    markEligible(challenge, 'daily', 0) // gold:1000
    markEligible(challenge, 'daily', 3) // exp:500 → 恰好一次 levelup → talent+1
    const goldBefore = player.player.gold
    const tpBefore = talent.talentPoints
    challenge.checkCompletion({ now: NOW })

    // 重新加载：新 pinia + 新 store（challenge/talent 自 load；player 需调用 loadGame）
    const fresh = createStores()
    fresh.player.loadGame()
    expect(fresh.player.player.gold).toBe(goldBefore + 1000)
    expect(fresh.talent.talentPoints).toBe(tpBefore + 1)
    expect(fresh.player.battlePass.exp).toBeGreaterThan(0)
    expect(fresh.challenge.dailyChallenges.find(c => c.id === 'daily_kill_50')!.completed).toBe(true)
    expect(fresh.challenge.dailyChallenges.find(c => c.id === 'daily_training_20')!.completed).toBe(true)
  })

  it('失败 fresh Pinia 保持事务前状态（精确相等，非宽松）', () => {
    const { challenge, player, talent } = createStores()
    markEligible(challenge, 'daily', 0)
    const goldBefore = player.player.gold
    const diamondBefore = player.player.diamond
    const expBefore = player.player.experience
    const lvlBefore = player.player.level
    const statsBefore = { ...player.player.stats }
    const bpExpBefore = player.battlePass.exp
    const tpBefore = talent.talentPoints
    const completedBefore = [
      ...challenge.dailyChallenges.map(c => c.completed),
      ...challenge.weeklyChallenges.map(c => c.completed),
    ]
    armSetItemFail([BATTLEPASS_KEY])
    challenge.checkCompletion({ now: NOW })

    const fresh = createStores()
    fresh.player.loadGame()
    // 失败未落盘任何奖励（writtenRaws 为空 → 补偿为空 → 回滚生效），重载应精确等于起始状态。
    expect(fresh.player.player.gold).toBe(goldBefore)
    expect(fresh.player.player.diamond).toBe(diamondBefore)
    expect(fresh.player.player.experience).toBe(expBefore)
    expect(fresh.player.player.level).toBe(lvlBefore)
    expect(fresh.player.player.stats).toEqual(statsBefore)
    expect(fresh.player.battlePass.exp).toBe(bpExpBefore)
    expect(fresh.talent.talentPoints).toBe(tpBefore)
    expect([
      ...fresh.challenge.dailyChallenges.map(c => c.completed),
      ...fresh.challenge.weeklyChallenges.map(c => c.completed),
    ]).toEqual(completedBefore)
  })

  it('失败后再次成功仅有一份奖励', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0) // gold:1000
    const goldBefore = player.player.gold
    armSetItemFail([WEEKLY_KEY])
    expect(challenge.checkCompletion({ now: NOW })).toEqual([]) // 失败
    vi.restoreAllMocks() // 解除 setItem 失败注入
    const result = challenge.checkCompletion({ now: NOW }) // 再次成功
    expect(result.length).toBe(1)
    expect(player.player.gold).toBe(goldBefore + 1000) // 仅一份，不双发
  })
})

describe('Phase 3.74 — 固定持久化顺序', () => {
  it('gold-only：写入 BattlePass/Main/Daily/Weekly，不写 Talent', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'daily', 0) // gold only
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    challenge.checkCompletion({ now: NOW })
    const written = setItemSpy.mock.calls.map(c => c[0])
    expect(written).toContain(BATTLEPASS_KEY)
    expect(written).toContain(MAIN_KEY)
    expect(written).toContain(DAILY_KEY)
    expect(written).toContain(WEEKLY_KEY)
    expect(written).not.toContain(TALENT_KEY)
  })

  it('exp-level-up：写入 BattlePass/Talent/Main/Daily/Weekly', () => {
    const { challenge, player } = createStores()
    player.player.level = 1
    markEligible(challenge, 'daily', 3) // exp → levelup → talent
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    challenge.checkCompletion({ now: NOW })
    const written = setItemSpy.mock.calls.map(c => c[0])
    expect(written).toContain(BATTLEPASS_KEY)
    expect(written).toContain(TALENT_KEY)
    expect(written).toContain(MAIN_KEY)
    expect(written).toContain(DAILY_KEY)
    expect(written).toContain(WEEKLY_KEY)
  })

  it('diamond-only：写入 Main/Daily/Weekly，不写 BattlePass/Talent', () => {
    const { challenge } = createStores()
    markEligible(challenge, 'weekly', 0) // diamond only
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    challenge.checkCompletion({ now: NOW })
    const written = setItemSpy.mock.calls.map(c => c[0])
    expect(written).toContain(MAIN_KEY)
    expect(written).toContain(DAILY_KEY)
    expect(written).toContain(WEEKLY_KEY)
    expect(written).not.toContain(BATTLEPASS_KEY)
    expect(written).not.toContain(TALENT_KEY)
  })

  it('Player main checkpoint 使用同一 timestamp', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    const saveSpy = vi.spyOn(player, 'saveGame')
    challenge.checkCompletion({ now: NOW })
    expect(saveSpy).toHaveBeenCalledWith(NOW)
  })
})

describe('Phase 3.74 — claimReward 委托', () => {
  it('claimReward 只委托事务且不双发', () => {
    const { challenge, player } = createStores()
    markEligible(challenge, 'daily', 0)
    const goldBefore = player.player.gold
    challenge.claimReward('daily_kill_50')
    challenge.claimReward('daily_kill_50') // 第二次应无新增（已完成）
    expect(player.player.gold).toBe(goldBefore + 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3.74 Repair 1 — P1-1：前置门与冷 Store 零副作用
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 3.74 Repair 1 — 前置门与冷 Store 零副作用', () => {
  it('非法 now：零 storage / 不创建依赖 Store', () => {
    const { challenge } = createChallengeOnly()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const playerSpy = vi.spyOn(playerStoreModule, 'usePlayerStore')
    const talentSpy = vi.spyOn(talentStoreModule, 'useTalentStore')

    for (const bad of [0, -1, NaN, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(challenge.checkCompletion({ now: bad as number })).toEqual([])
    }
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(playerSpy).not.toHaveBeenCalled()
    expect(talentSpy).not.toHaveBeenCalled()
  })

  it('缺省 Date.now 抛错：返回 [] / 零 storage / 不创建依赖 Store', () => {
    const { challenge } = createChallengeOnly() // 构造期 Date.now 正常
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clk') })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const playerSpy = vi.spyOn(playerStoreModule, 'usePlayerStore')
    const talentSpy = vi.spyOn(talentStoreModule, 'useTalentStore')

    expect(challenge.checkCompletion()).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(playerSpy).not.toHaveBeenCalled()
    expect(talentSpy).not.toHaveBeenCalled()
  })

  it('无 eligible challenge：零 storage / 不创建依赖 Store', () => {
    const { challenge } = createChallengeOnly() // 未 markEligible → 无候选
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const playerSpy = vi.spyOn(playerStoreModule, 'usePlayerStore')
    const talentSpy = vi.spyOn(talentStoreModule, 'useTalentStore')

    expect(challenge.checkCompletion({ now: NOW })).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(playerSpy).not.toHaveBeenCalled()
    expect(talentSpy).not.toHaveBeenCalled()
  })

  it('依赖 Store 创建失败：返回 [] / completed 不变 / 零奖励 / 零事务 storage', () => {
    const { challenge } = createChallengeOnly()
    markEligible(challenge, 'daily', 0)
    // 仅让 checkCompletion 内部的 usePlayerStore() 抛错（构造期不调用）。
    const playerSpy = vi.spyOn(playerStoreModule, 'usePlayerStore').mockImplementation(() => {
      throw new Error('player init boom')
    })
    const talentSpy = vi.spyOn(talentStoreModule, 'useTalentStore')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')

    const result = challenge.checkCompletion({ now: NOW })
    expect(result).toEqual([])
    expect(challengeById(challenge, 'daily_kill_50')!.completed).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(talentSpy).not.toHaveBeenCalled() // player 先抛，talent 不应被触及
    playerSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3.74 Repair 1 — P1-2：候选阶段统一异常边界（修改后抛错 → 完整回滚）
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 3.74 Repair 1 — 候选异常完整回滚', () => {
  // 通用：捕获事务前全部相关状态。
  function snapshot(s: ReturnType<typeof createStores>) {
    return {
      gold: s.player.player.gold,
      diamond: s.player.player.diamond,
      experience: s.player.player.experience,
      level: s.player.player.level,
      maxHp: s.player.player.maxHp,
      stats: { ...s.player.player.stats },
      unlockedPhases: [...s.player.player.unlockedPhases],
      checkpoint: s.player.lastOfflineCheckpointAt,
      bpExp: s.player.battlePass.exp,
      bpLevel: s.player.battlePass.level,
      tp: s.talent.talentPoints,
      dailyCompleted: s.challenge.dailyChallenges.map(c => c.completed),
      weeklyCompleted: s.challenge.weeklyChallenges.map(c => c.completed),
    }
  }
  function assertRolledBack(s: ReturnType<typeof createStores>, before: ReturnType<typeof snapshot>) {
    expect(s.player.player.gold).toBe(before.gold)
    expect(s.player.player.diamond).toBe(before.diamond)
    expect(s.player.player.experience).toBe(before.experience)
    expect(s.player.player.level).toBe(before.level)
    expect(s.player.player.maxHp).toBe(before.maxHp)
    expect(s.player.player.stats).toEqual(before.stats)
    expect(s.player.player.unlockedPhases).toEqual(before.unlockedPhases)
    expect(s.player.lastOfflineCheckpointAt).toBe(before.checkpoint)
    expect(s.player.battlePass.exp).toBe(before.bpExp)
    expect(s.player.battlePass.level).toBe(before.bpLevel)
    expect(s.talent.talentPoints).toBe(before.tp)
    expect(s.challenge.dailyChallenges.map(c => c.completed)).toEqual(before.dailyCompleted)
    expect(s.challenge.weeklyChallenges.map(c => c.completed)).toEqual(before.weeklyCompleted)
  }

  it('第一条 gold 已应用，第二条 exp helper 抛错 → 完整回滚', () => {
    const s = createStores()
    markEligible(s.challenge, 'daily', 0) // gold:1000
    markEligible(s.challenge, 'daily', 3) // exp:500 → 会升级
    const before = snapshot(s)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const origExp = s.player.applyExperienceRewardInMemory
    const expSpy = vi.spyOn(s.player, 'applyExperienceRewardInMemory').mockImplementation((amt: number) => {
      origExp(amt) // 先修改 experience/level/stats/BattlePass/Talent
      throw new Error('exp boom')
    })

    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    assertRolledBack(s, before)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expSpy.mockRestore()
  })

  it('applyGoldRewardInMemory 修改 gold/BattlePass 后抛错 → 完整回滚', () => {
    const s = createStores()
    markEligible(s.challenge, 'daily', 0) // gold:1000
    const before = snapshot(s)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const origGold = s.player.applyGoldRewardInMemory
    const goldSpy = vi.spyOn(s.player, 'applyGoldRewardInMemory').mockImplementation((amt: number) => {
      origGold(amt)
      throw new Error('gold boom')
    })

    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    assertRolledBack(s, before)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    goldSpy.mockRestore()
  })

  it('applyDiamondRewardInMemory 修改 diamond 后抛错 → 完整回滚', () => {
    const s = createStores()
    markEligible(s.challenge, 'weekly', 0) // diamond:50
    const before = snapshot(s)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const origDiamond = s.player.applyDiamondRewardInMemory
    const diamondSpy = vi.spyOn(s.player, 'applyDiamondRewardInMemory').mockImplementation((amt: number) => {
      origDiamond(amt)
      throw new Error('diamond boom')
    })

    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    assertRolledBack(s, before)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    diamondSpy.mockRestore()
  })

  it('applyExperienceRewardInMemory 修改 experience/level/stats/BattlePass/Talent 后抛错 → 完整回滚', () => {
    const s = createStores()
    s.player.player.level = 1 // exp 500 跨等级，触发 level/stats/maxHp/phase/talent 修改
    markEligible(s.challenge, 'daily', 3) // exp:500
    const before = snapshot(s)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const origExp = s.player.applyExperienceRewardInMemory
    const expSpy = vi.spyOn(s.player, 'applyExperienceRewardInMemory').mockImplementation((amt: number) => {
      origExp(amt)
      throw new Error('exp boom')
    })

    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    assertRolledBack(s, before)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expSpy.mockRestore()
  })

  it('battlePass 跨级（exp≥5000 → bp.level+1）后 helper 抛错 → bp.level 完整回滚', () => {
    const s = createStores()
    s.player.player.level = 1
    markEligible(s.challenge, 'daily', 3) // 默认 exp:500
    // 放大 exp 使 applyBattlePassExpInMemory 跨越 1000 → battlePass.level 上升。
    s.challenge.dailyChallenges[3].reward.exp = 5000
    const before = snapshot(s)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const origExp = s.player.applyExperienceRewardInMemory
    const expSpy = vi.spyOn(s.player, 'applyExperienceRewardInMemory').mockImplementation((amt: number) => {
      origExp(amt) // 先修改 experience/level/stats/BattlePass(level)/Talent
      throw new Error('exp boom')
    })

    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    // 关键：bp.level 必须被回滚到事务前（此前仅快照 bp.exp 会遗漏 level）。
    expect(s.player.battlePass.level).toBe(before.bpLevel)
    expect(s.player.battlePass.exp).toBe(before.bpExp)
    assertRolledBack(s, before)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expSpy.mockRestore()
  })

  it('候选失败后重试：恰好一份奖励、completed 恰好一次、无残留', () => {
    const s = createStores()
    markEligible(s.challenge, 'daily', 0) // gold:1000
    const goldBefore = s.player.player.gold
    const origGold = s.player.applyGoldRewardInMemory
    const goldSpy = vi.spyOn(s.player, 'applyGoldRewardInMemory').mockImplementation((amt: number) => {
      origGold(amt)
      throw new Error('gold boom')
    })

    // 第一次：候选阶段抛错 → 回滚 → []
    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    expect(s.player.player.gold).toBe(goldBefore)
    goldSpy.mockRestore() // 解除注入

    // 第二次：成功，恰好一份
    const result = s.challenge.checkCompletion({ now: NOW })
    expect(result.length).toBe(1)
    expect(s.player.player.gold).toBe(goldBefore + 1000)
    expect(challengeById(s.challenge, 'daily_kill_50')!.completed).toBe(true)

    // 第三次：已完成 → 零奖励，无前一次残留
    const afterSecond = s.player.player.gold
    const third = s.challenge.checkCompletion({ now: NOW })
    expect(third).toEqual([])
    expect(s.player.player.gold).toBe(afterSecond)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3.74 Repair 1 — P2：fresh failure 精确重载证据
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 3.74 Repair 1 — fresh failure 精确重载', () => {
  it('失败事务精确保持 Player/BattlePass/Talent/Challenge 与所有相关 raw', () => {
    const s = createStores()
    s.player.player.level = 1 // exp 500 跨等级，覆盖四类状态
    markEligible(s.challenge, 'daily', 0) // gold:1000
    markEligible(s.challenge, 'daily', 3) // exp:500 → 升级 → talent 改变

    const before = {
      gold: s.player.player.gold,
      diamond: s.player.player.diamond,
      experience: s.player.player.experience,
      level: s.player.player.level,
      maxHp: s.player.player.maxHp,
      stats: { ...s.player.player.stats },
      unlockedPhases: [...s.player.player.unlockedPhases],
      bpExp: s.player.battlePass.exp,
      bpLevel: s.player.battlePass.level,
      tp: s.talent.talentPoints,
      dailyCompleted: s.challenge.dailyChallenges.map(c => c.completed),
      weeklyCompleted: s.challenge.weeklyChallenges.map(c => c.completed),
    }
    // 事务前相关 raw（load 已写盘，代表事务前持久化状态）。
    const rawBefore = {
      bp: localStorage.getItem(BATTLEPASS_KEY),
      talent: localStorage.getItem(TALENT_KEY),
      main: localStorage.getItem(MAIN_KEY),
      daily: localStorage.getItem(DAILY_KEY),
      weekly: localStorage.getItem(WEEKLY_KEY),
    }

    // BattlePass 写失败：writtenRaws 为空 → 补偿为空 → 返回 [] 且不抛（无残留写盘）。
    armSetItemFail([BATTLEPASS_KEY])
    expect(s.challenge.checkCompletion({ now: NOW })).toEqual([])
    vi.restoreAllMocks()

    // 重新加载：新 pinia + 新 store（challenge/talent 自 load；player 需 loadGame）。
    const fresh = createStores()
    fresh.player.loadGame()
    expect(fresh.player.player.gold).toBe(before.gold)
    expect(fresh.player.player.diamond).toBe(before.diamond)
    expect(fresh.player.player.experience).toBe(before.experience)
    expect(fresh.player.player.level).toBe(before.level)
    expect(fresh.player.player.maxHp).toBe(before.maxHp)
    expect(fresh.player.player.stats).toEqual(before.stats)
    expect(fresh.player.player.unlockedPhases).toEqual(before.unlockedPhases)
    expect(fresh.player.battlePass.exp).toBe(before.bpExp)
    expect(fresh.player.battlePass.level).toBe(before.bpLevel)
    expect(fresh.talent.talentPoints).toBe(before.tp)
    expect(fresh.challenge.dailyChallenges.map(c => c.completed)).toEqual(before.dailyCompleted)
    expect(fresh.challenge.weeklyChallenges.map(c => c.completed)).toEqual(before.weeklyCompleted)
    expect(localStorage.getItem(BATTLEPASS_KEY)).toBe(rawBefore.bp)
    expect(localStorage.getItem(TALENT_KEY)).toBe(rawBefore.talent)
    expect(localStorage.getItem(MAIN_KEY)).toBe(rawBefore.main)
    expect(localStorage.getItem(DAILY_KEY)).toBe(rawBefore.daily)
    expect(localStorage.getItem(WEEKLY_KEY)).toBe(rawBefore.weekly)
  })
})
