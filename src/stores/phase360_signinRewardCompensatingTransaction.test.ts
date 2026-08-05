// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from './playerStore'
import { useMonsterStore } from './monsterStore'
import { useGameStore } from './gameStore'
import { useTrainingStore } from './trainingStore'
import { useATBStore } from './atbStore'
import { useRebirthStore } from './rebirthStore'
import { useThemeStore } from './themeStore'
import { useSigninStore } from './signinStore'
import SigninTab from '../components/SigninTab.vue'

/**
 * Phase 3.60 — 每日签到奖励同步补偿事务。
 *
 * - signin() 收口为 SigninTransactionResult；权威资格门在任何 mutation/写盘前拒绝；
 * - 事务前快照签到 refs、Player 货币与金币路径完整战令状态、旧 raw；
 * - 成功提交顺序：金币路径 战令 key → 签到 key → 主存档；钻石路径 签到 key → 主存档；
 * - 任何失败：内存精确回滚 → 逆序补偿已写入 key → 返回失败；补偿自身失败抛
 *   'signin persistence rollback failed'。
 * - 只保证一次 signin() 同步调用内的失败原子性，不宣称跨 key 断电 ACID。
 */

const SIGNIN_KEY = 'nz_signin'
const BATTLEPASS_KEY = 'nz_battlepass_v1'
const MAIN_KEY = 'lollipop_adventure_save'
const TODAY = new Date().toISOString().split('T')[0]

function warmupStores() {
  usePlayerStore()
  useMonsterStore()
  useGameStore()
  useTrainingStore()
  useATBStore()
  useRebirthStore()
  useThemeStore()
}

function seedFresh() {
  const playerStore = usePlayerStore()
  const signinStore = useSigninStore()
  signinStore.todaySigned = false
  signinStore.consecutiveDays = 0
  signinStore.lastSigninDate = null
  signinStore.totalSignins = 0
  playerStore.player.gold = 0
  playerStore.player.diamond = 0
  playerStore.battlePass = { level: 0, exp: 0, freeRewards: [], premiumRewards: [], purchased: false }
  return { playerStore, signinStore }
}

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  warmupStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('../data/signin')
})

describe('Phase 3.60 — 成功路径', () => {
  it('第一天金币奖励成功：gold 精确 +100、战令经验 +10、ok:true', () => {
    const { playerStore, signinStore } = seedFresh()
    const result = signinStore.signin()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.reward).toEqual({ day: 1, type: 'gold', amount: 100 })
    }
    expect(playerStore.player.gold).toBe(100)
    expect(playerStore.battlePass.exp).toBe(10) // floor(100/10)
    expect(playerStore.battlePass.level).toBe(0)
    expect(signinStore.todaySigned).toBe(true)
    expect(signinStore.lastSigninDate).toBe(TODAY)
    expect(signinStore.consecutiveDays).toBe(1)
    expect(signinStore.totalSignins).toBe(1)
  })

  it('第三天钻石奖励成功：diamond +5、不写战令 key', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.consecutiveDays = 2
    signinStore.totalSignins = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const result = signinStore.signin()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reward).toEqual({ day: 3, type: 'diamond', amount: 5 })
    expect(playerStore.player.diamond).toBe(5)
    expect(playerStore.player.gold).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length).toBe(0)
  })

  it('第七天钻石奖励成功（周奖励）', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.consecutiveDays = 6
    signinStore.totalSignins = 6
    const result = signinStore.signin()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reward).toEqual({ day: 7, type: 'diamond', amount: 20 })
    expect(playerStore.player.diamond).toBe(20)
  })

  it('第七天后正确循环回第一天', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.consecutiveDays = 7
    signinStore.totalSignins = 7
    const result = signinStore.signin()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reward).toEqual({ day: 1, type: 'gold', amount: 100 }) // 循环回第 1 天
    expect(playerStore.player.gold).toBe(100)
    expect(signinStore.consecutiveDays).toBe(8)
  })

  it('战令经验跨级时 level/exp 正确', () => {
    const { playerStore, signinStore } = seedFresh()
    playerStore.battlePass = { level: 0, exp: 995, freeRewards: [], premiumRewards: [], purchased: false }
    const result = signinStore.signin()
    expect(result.ok).toBe(true)
    expect(playerStore.battlePass.exp).toBe(5) // 995 + 10 = 1005 → 1000 升 1 级
    expect(playerStore.battlePass.level).toBe(1)
  })

  it('金币路径三个 key 写入顺序：战令 → 签到 → 主存档', () => {
    const { signinStore } = seedFresh()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    signinStore.signin()
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [BATTLEPASS_KEY, SIGNIN_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([BATTLEPASS_KEY, SIGNIN_KEY, MAIN_KEY])
  })

  it('钻石路径两个 key 写入顺序：签到 → 主存档', () => {
    const { signinStore } = seedFresh()
    signinStore.consecutiveDays = 2
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    signinStore.signin()
    const keys = setItemSpy.mock.calls.map(c => c[0]).filter(k => [BATTLEPASS_KEY, SIGNIN_KEY, MAIN_KEY].includes(k))
    expect(keys).toEqual([SIGNIN_KEY, MAIN_KEY])
  })

  it('saveGame 恰好一次、各 key 恰好写一次', () => {
    const { playerStore, signinStore } = seedFresh()
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    signinStore.signin()
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === BATTLEPASS_KEY).length).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SIGNIN_KEY).length).toBe(1)
    expect(setItemSpy.mock.calls.filter(c => c[0] === MAIN_KEY).length).toBe(1)
  })

  it('成功 disk 与内存一致', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.signin()
    const diskSignin = JSON.parse(localStorage.getItem(SIGNIN_KEY)!)
    expect(diskSignin.todaySigned).toBe(true)
    expect(diskSignin.lastSigninDate).toBe(TODAY)
    expect(diskSignin.consecutiveDays).toBe(1)
    expect(diskSignin.totalSignins).toBe(1)
    const diskBp = JSON.parse(localStorage.getItem(BATTLEPASS_KEY)!)
    expect(diskBp.exp).toBe(playerStore.battlePass.exp)
    expect(diskBp.level).toBe(playerStore.battlePass.level)
    const mainSave = JSON.parse(localStorage.getItem(MAIN_KEY)!)
    expect(mainSave.player.gold).toBe(100)
  })
})

describe('Phase 3.60 — 资格拒绝（零 mutation / 零写盘 / 零 saveGame）', () => {
  it('已签到：already signed', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.todaySigned = true
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'already signed' })
    expect(signinStore.todaySigned).toBe(true)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('consecutiveDays 非法（负数/小数/NaN/Infinity/unsafe）→ invalid state', () => {
    const { playerStore, signinStore } = seedFresh()
    for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, 9007199254740992]) {
      signinStore.todaySigned = false
      signinStore.consecutiveDays = bad
      signinStore.totalSignins = 0
      playerStore.player.gold = 0
      expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
      expect(signinStore.todaySigned).toBe(false)
      expect(playerStore.player.gold).toBe(0)
    }
  })

  it('totalSignins 非法 → invalid state', () => {
    const { playerStore, signinStore } = seedFresh()
    for (const bad of [-1, 2.5, NaN, Infinity, 9007199254740992]) {
      signinStore.todaySigned = false
      signinStore.consecutiveDays = 0
      signinStore.totalSignins = bad
      playerStore.player.gold = 0
      expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
      expect(signinStore.todaySigned).toBe(false)
      expect(playerStore.player.gold).toBe(0)
    }
  })

  it('Player 货币非法 → invalid state', () => {
    const { playerStore, signinStore } = seedFresh()
    playerStore.player.gold = -1
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    playerStore.player.gold = 0
    playerStore.player.diamond = -1
    signinStore.consecutiveDays = 2 // 钻石路径
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
  })

  it('加法溢出 safe integer → invalid state', () => {
    const { playerStore, signinStore } = seedFresh()
    playerStore.player.gold = Number.MAX_SAFE_INTEGER
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    playerStore.player.gold = 0
    playerStore.player.diamond = Number.MAX_SAFE_INTEGER
    signinStore.consecutiveDays = 2 // 钻石路径 +5
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
  })

  it('金币路径战令状态非法 → invalid state', () => {
    const { playerStore, signinStore } = seedFresh()
    // level 非法
    playerStore.battlePass = { level: -1, exp: 0, freeRewards: [], premiumRewards: [], purchased: false }
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    // exp 非法
    playerStore.battlePass = { level: 0, exp: NaN, freeRewards: [], premiumRewards: [], purchased: false }
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    // freeRewards 非数组
    playerStore.battlePass = { level: 0, exp: 0, freeRewards: 'x' as never, premiumRewards: [], purchased: false }
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    // purchased 非 boolean
    playerStore.battlePass = { level: 0, exp: 0, freeRewards: [], premiumRewards: [], purchased: 1 as never }
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    // exp 增长溢出
    playerStore.battlePass = { level: 0, exp: Number.MAX_SAFE_INTEGER - 5, freeRewards: [], premiumRewards: [], purchased: false }
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
  })

  it('所有拒绝分支零 mutation、零 set/remove、零 saveGame、零奖励发放', () => {
    const { playerStore, signinStore } = seedFresh()
    signinStore.consecutiveDays = -1
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(-1)
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.player.diamond).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.60 — 故障注入与完整回滚', () => {
  it('getItem(nz_signin) 抛错：零 mutation、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === SIGNIN_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('金币路径 getItem(nz_battlepass_v1) 抛错：零 mutation、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === BATTLEPASS_KEY) throw new Error('read boom')
      return originalGetItem.call(this, key)
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('战令 key setItem 抛错：内存精确回滚、零后续写入、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === BATTLEPASS_KEY) throw new Error('bp disk full')
    })
    const setItemSpy = vi.mocked(Storage.prototype.setItem)
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(signinStore.lastSigninDate).toBeNull()
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(setItemSpy.mock.calls.filter(c => c[0] === SIGNIN_KEY).length).toBe(0)
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('nz_signin 写入抛错（金币路径战令已写入）：补偿战令 key、完整回滚、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    seedSigninRaw(null)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === SIGNIN_KEY) throw new Error('signin disk full')
    })
    const saveGameSpy = vi.spyOn(playerStore, 'saveGame')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(localStorage.getItem(BATTLEPASS_KEY)).toBeNull() // 旧 raw 为 null → removeItem 补偿
    expect(saveGameSpy).not.toHaveBeenCalled()
  })

  it('saveGame 返回 false（金币路径两 key 已写入）：逆序补偿两个 key、完整回滚、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    const prevSigninRaw = JSON.stringify({ todaySigned: false, consecutiveDays: 0, lastSigninDate: null, totalSignins: 0 })
    const prevBpRaw = JSON.stringify({ level: 0, exp: 0, freeRewards: [], premiumRewards: [], purchased: false })
    seedSigninRaw(prevSigninRaw)
    seedBpRaw(prevBpRaw)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(localStorage.getItem(SIGNIN_KEY)).toBe(prevSigninRaw)
    expect(localStorage.getItem(BATTLEPASS_KEY)).toBe(prevBpRaw)
    const restoreCalls = setItemSpy.mock.calls.filter(c => c[0] === SIGNIN_KEY || c[0] === BATTLEPASS_KEY)
    expect(restoreCalls.length).toBe(4) // 各 2 次：事务写入 + 补偿恢复
  })

  it('saveGame 抛异常（钻石路径签到已写入）：补偿签到 key、完整回滚、返回失败', () => {
    const { playerStore, signinStore } = seedFresh()
    seedSigninRaw(null)
    signinStore.consecutiveDays = 2 // 钻石路径
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      throw new Error('main boom')
    })
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(2)
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.diamond).toBe(0)
    expect(localStorage.getItem(SIGNIN_KEY)).toBeNull() // 旧 raw null → removeItem
  })

  it('钻石路径旧 raw 非 null：main save 失败后恢复旧字节', () => {
    const { playerStore, signinStore } = seedFresh()
    const prevSigninRaw = JSON.stringify({ todaySigned: false, consecutiveDays: 1, lastSigninDate: null, totalSignins: 1 })
    seedSigninRaw(prevSigninRaw)
    signinStore.consecutiveDays = 2
    signinStore.totalSignins = 1
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'persistence failed' })
    expect(localStorage.getItem(SIGNIN_KEY)).toBe(prevSigninRaw)
  })

  it('失败后不重复业务执行、不重复 main save', () => {
    const { playerStore, signinStore } = seedFresh()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const saveGameSpy = vi.mocked(playerStore.saveGame)
    signinStore.signin()
    expect(saveGameSpy).toHaveBeenCalledTimes(1)
    // 回滚后再次调用仍可正常走资格门（todaySigned 已恢复）
    signinStore.signin()
    expect(saveGameSpy).toHaveBeenCalledTimes(2) // 第二次是独立请求
    expect(signinStore.totalSignins).toBe(0) // 两次都失败，均回滚
  })
})

describe('Phase 3.60 — 补偿自身失败', () => {
  it('main save 失败后恢复 nz_signin 抛错：抛 signin persistence rollback failed、内存仍回滚', () => {
    const { playerStore, signinStore } = seedFresh()
    const prevSigninRaw = JSON.stringify({ todaySigned: false, consecutiveDays: 0, lastSigninDate: null, totalSignins: 0 })
    const prevBpRaw = JSON.stringify({ level: 0, exp: 0, freeRewards: [], premiumRewards: [], purchased: false })
    seedSigninRaw(prevSigninRaw)
    seedBpRaw(prevBpRaw)
    let mainFailed = false
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      mainFailed = true
      return false
    })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === SIGNIN_KEY && mainFailed) throw new Error('signin restore boom')
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      signinStore.signin()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('signin persistence rollback failed')
    expect(signinStore.todaySigned).toBe(false)
    expect(signinStore.consecutiveDays).toBe(0)
    expect(signinStore.totalSignins).toBe(0)
    expect(playerStore.player.gold).toBe(0)
    expect(playerStore.battlePass.exp).toBe(0)
    expect(localStorage.getItem(BATTLEPASS_KEY)).toBe(prevBpRaw) // 另一 key 仍被补偿
  })

  it('main save 失败后恢复战令 raw 抛错：signin 仍被尝试恢复、抛 signin persistence rollback failed', () => {
    const { playerStore, signinStore } = seedFresh()
    const prevSigninRaw = JSON.stringify({ todaySigned: false, consecutiveDays: 0, lastSigninDate: null, totalSignins: 0 })
    const prevBpRaw = JSON.stringify({ level: 0, exp: 0, freeRewards: [], premiumRewards: [], purchased: false })
    seedSigninRaw(prevSigninRaw)
    seedBpRaw(prevBpRaw)
    let mainFailed = false
    vi.spyOn(playerStore, 'saveGame').mockImplementation(() => {
      mainFailed = true
      return false
    })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === BATTLEPASS_KEY && mainFailed) throw new Error('bp restore boom')
      return originalSetItem.call(this, key, value)
    })
    let thrown: unknown
    try {
      signinStore.signin()
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toBe('signin persistence rollback failed')
    expect(signinStore.todaySigned).toBe(false)
    expect(playerStore.player.gold).toBe(0)
    expect(localStorage.getItem(SIGNIN_KEY)).toBe(prevSigninRaw) // 另一个 key 恢复仍被尝试并成功
  })
})

describe('Phase 3.60 — reward 数据缺失/非法 fail-closed', () => {
  it('SIGNIN_REWARDS 为空 → invalid state、零 mutation', async () => {
    vi.resetModules()
    vi.doMock('../data/signin', () => ({ SIGNIN_REWARDS: [], SIGNIN_CYCLE: 7 }))
    const { useSigninStore } = await import('./signinStore')
    setActivePinia(createPinia())
    localStorage.clear()
    usePlayerStore()
    const signinStore = useSigninStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    expect(signinStore.todaySigned).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('reward type 为不受支持的 material → invalid state、零 mutation', async () => {
    vi.resetModules()
    vi.doMock('../data/signin', () => ({
      SIGNIN_REWARDS: [{ day: 1, type: 'material', amount: 5 }],
      SIGNIN_CYCLE: 7
    }))
    const { useSigninStore } = await import('./signinStore')
    setActivePinia(createPinia())
    localStorage.clear()
    usePlayerStore()
    const signinStore = useSigninStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    expect(signinStore.signin()).toEqual({ ok: false, reason: 'invalid state' })
    expect(signinStore.todaySigned).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('Phase 3.60 — SigninTab emit 语义', () => {
  it('成功只 emit 一次 claimed 且 reward 精确', () => {
    const { signinStore } = seedFresh()
    const wrapper = mount(SigninTab, { global: { plugins: [pinia] } })
    wrapper.find('.signin-btn').trigger('click')
    const emitted = wrapper.emitted('claimed')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBe(1)
    expect(emitted![0][0]).toEqual({ day: 1, type: 'gold', amount: 100 })
    expect(signinStore.todaySigned).toBe(true)
    wrapper.unmount()
  })

  it('持久化失败零 success emit', () => {
    const { playerStore, signinStore } = seedFresh()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const wrapper = mount(SigninTab, { global: { plugins: [pinia] } })
    wrapper.find('.signin-btn').trigger('click')
    expect(wrapper.emitted('claimed')).toBeUndefined()
    expect(signinStore.todaySigned).toBe(false) // 回滚后的真实 Store 状态
    wrapper.unmount()
  })

  it('补偿自身失败零 success emit', () => {
    const { playerStore, signinStore } = seedFresh()
    vi.spyOn(playerStore, 'saveGame').mockReturnValue(false)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === SIGNIN_KEY) throw new Error('restore boom')
      return originalSetItem.call(this, key, value)
    })
    const wrapper = mount(SigninTab, { global: { plugins: [pinia] } })
    expect(() => wrapper.find('.signin-btn').trigger('click')).not.toThrow()
    expect(wrapper.emitted('claimed')).toBeUndefined()
    expect(signinStore.todaySigned).toBe(false)
    wrapper.unmount()
  })
})

// 辅助：直接写入 seed raw（不计入事务写入 spy）
function seedSigninRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(SIGNIN_KEY)
  else localStorage.setItem(SIGNIN_KEY, raw)
}

function seedBpRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(BATTLEPASS_KEY)
  else localStorage.setItem(BATTLEPASS_KEY, raw)
}
