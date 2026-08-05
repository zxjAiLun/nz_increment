import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SIGNIN_REWARDS, SIGNIN_CYCLE } from '../data/signin'
import type { SigninReward } from '../data/signin'
import { usePlayerStore, BATTLE_PASS_MAX_LEVEL } from './playerStore'

const SIGNIN_KEY = 'nz_signin'
// playerStore 的战令 key（T8.1）。事务需读取/补偿该 key 的旧 raw。
const BATTLEPASS_KEY = 'nz_battlepass_v1'

// Phase 3.61：nz_signin 原子规范化水合专用 fail-closed helper。
function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0
}

/** 仅接受 null 或严格真实 UTC 日历日期 YYYY-MM-DD；其余一律归一为 null。 */
function normalizeUTCDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return value
}

/**
 * Phase 3.60：签到补偿事务结果。
 * - ok:true 代表奖励与持久化全部成功；
 * - ok:false.reason 区分预期资格拒绝与持久化失败；
 * - 补偿自身失败时 signin() 会抛 'signin persistence rollback failed'（不伪装为成功或普通拒绝）。
 */
export type SigninTransactionResult =
  | { ok: true; reward: SigninReward }
  | { ok: false; reason: 'already signed' | 'invalid state' | 'persistence failed' }

export const useSigninStore = defineStore('signin', () => {
  const playerStore = usePlayerStore()
  const todaySigned = ref(false)
  const consecutiveDays = ref(0)
  const lastSigninDate = ref<string | null>(null)
  const totalSignins = ref(0)

  function getToday(): string {
    return new Date().toISOString().split('T')[0]
  }

  function load() {
    let candidate: {
      todaySigned: boolean
      consecutiveDays: number
      lastSigninDate: string | null
      totalSignins: number
    } = { todaySigned: false, consecutiveDays: 0, lastSigninDate: null, totalSignins: 0 }
    try {
      const saved = localStorage.getItem(SIGNIN_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>
          const today = getToday() // UTC 日期计算异常 → 默认 candidate
          const normalizedLastSigninDate = normalizeUTCDate(record.lastSigninDate)
          candidate = {
            todaySigned: normalizeBoolean(record.todaySigned),
            consecutiveDays: normalizeNonNegativeInteger(record.consecutiveDays),
            lastSigninDate: normalizedLastSigninDate,
            totalSignins: normalizeNonNegativeInteger(record.totalSignins)
          }
          // 跨日规则：日期不等于 UTC today → 仅重置 todaySigned（计数器与合法日期保留）
          if (candidate.lastSigninDate !== today) {
            candidate.todaySigned = false
          }
        }
      }
    } catch {
      // getItem / JSON.parse / normalization / UTC today 异常 → 保持默认 candidate
    }
    // Phase 3.61：全部 parse/normalization 完成后一次性提交，杜绝部分水合。
    todaySigned.value = candidate.todaySigned
    consecutiveDays.value = candidate.consecutiveDays
    lastSigninDate.value = candidate.lastSigninDate
    totalSignins.value = candidate.totalSignins
  }

  function save() {
    localStorage.setItem(SIGNIN_KEY, JSON.stringify({
      todaySigned: todaySigned.value,
      consecutiveDays: consecutiveDays.value,
      lastSigninDate: lastSigninDate.value,
      totalSignins: totalSignins.value
    }))
  }

  function signin(): SigninTransactionResult {
    // Phase 3.60：权威资格门。任何 mutation / 写盘之前拒绝。
    if (todaySigned.value !== false) return { ok: false, reason: 'already signed' }
    if (!Number.isSafeInteger(consecutiveDays.value) || consecutiveDays.value < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(totalSignins.value) || totalSignins.value < 0) return { ok: false, reason: 'invalid state' }
    // Phase 3.60 Repair 1：候选计数必须预计算并在任何 mutation/raw 读取/写盘前验证，
    // 防止 +1 后溢出 safe integer 使事务成功写入损坏状态。
    const nextConsecutiveDays = consecutiveDays.value + 1
    const nextTotalSignins = totalSignins.value + 1
    if (!Number.isSafeInteger(nextConsecutiveDays) || !Number.isSafeInteger(nextTotalSignins)) {
      return { ok: false, reason: 'invalid state' }
    }

    const today = getToday()
    const cycleDay = (consecutiveDays.value % SIGNIN_CYCLE) + 1
    const reward = SIGNIN_REWARDS[cycleDay - 1]
    if (!reward) return { ok: false, reason: 'invalid state' }
    if (reward.type !== 'gold' && reward.type !== 'diamond') return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) return { ok: false, reason: 'invalid state' }

    const player = playerStore.player
    if (!Number.isSafeInteger(player.gold) || player.gold < 0) return { ok: false, reason: 'invalid state' }
    if (!Number.isSafeInteger(player.diamond) || player.diamond < 0) return { ok: false, reason: 'invalid state' }

    if (reward.type === 'gold') {
      if (player.gold + reward.amount > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'invalid state' }
      // 金币路径：战令状态必须能安全执行既有经验增长。
      const battlePass = playerStore.battlePass
      if (!Number.isSafeInteger(battlePass.level) || battlePass.level < 0 || battlePass.level > BATTLE_PASS_MAX_LEVEL) return { ok: false, reason: 'invalid state' }
      if (!Number.isSafeInteger(battlePass.exp) || battlePass.exp < 0) return { ok: false, reason: 'invalid state' }
      if (!Array.isArray(battlePass.freeRewards) || !Array.isArray(battlePass.premiumRewards)) return { ok: false, reason: 'invalid state' }
      if (typeof battlePass.purchased !== 'boolean') return { ok: false, reason: 'invalid state' }
      if (battlePass.exp + Math.floor(reward.amount / 10) > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'invalid state' }
    } else {
      if (player.diamond + reward.amount > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'invalid state' }
    }

    // 事务前快照（任何 mutation 之前）。
    const prevTodaySigned = todaySigned.value
    const prevConsecutiveDays = consecutiveDays.value
    const prevLastSigninDate = lastSigninDate.value
    const prevTotalSignins = totalSignins.value

    const prevGold = player.gold
    const prevDiamond = player.diamond

    const prevBattlePass = reward.type === 'gold'
      ? {
          level: playerStore.battlePass.level,
          exp: playerStore.battlePass.exp,
          freeRewards: playerStore.battlePass.freeRewards,
          premiumRewards: playerStore.battlePass.premiumRewards,
          purchased: playerStore.battlePass.purchased
        }
      : null

    // 旧 raw 快照（getItem 抛错 → 零 mutation 返回失败）。
    let prevSigninRaw: string | null
    let prevBattlePassRaw: string | null = null
    try {
      prevSigninRaw = localStorage.getItem(SIGNIN_KEY)
      if (reward.type === 'gold') prevBattlePassRaw = localStorage.getItem(BATTLEPASS_KEY)
    } catch {
      return { ok: false, reason: 'persistence failed' }
    }

    function rollbackMemory() {
      todaySigned.value = prevTodaySigned
      consecutiveDays.value = prevConsecutiveDays
      lastSigninDate.value = prevLastSigninDate
      totalSignins.value = prevTotalSignins

      player.gold = prevGold
      player.diamond = prevDiamond

      if (prevBattlePass) {
        playerStore.battlePass = {
          level: prevBattlePass.level,
          exp: prevBattlePass.exp,
          freeRewards: prevBattlePass.freeRewards,
          premiumRewards: prevBattlePass.premiumRewards,
          purchased: prevBattlePass.purchased
        }
      }
    }

    // 逆序补偿已写入 key；全部尝试并收集失败，不因第一个错误跳过后续补偿。
    function compensateRaws(raws: { key: string; previous: string | null }[]): unknown[] {
      const failures: unknown[] = []
      for (let i = raws.length - 1; i >= 0; i--) {
        const { key, previous } = raws[i]
        try {
          if (previous === null) localStorage.removeItem(key)
          else localStorage.setItem(key, previous)
        } catch (error) {
          failures.push(error)
        }
      }
      return failures
    }

    // 失败收口：内存回滚 → 补偿已写入 key → 补偿失败抛固定分类错误。
    function finalizeFailure(writtenRaws: { key: string; previous: string | null }[]): SigninTransactionResult {
      rollbackMemory()
      const failures = compensateRaws(writtenRaws)
      if (failures.length > 0) {
        throw new Error('signin persistence rollback failed')
      }
      return { ok: false, reason: 'persistence failed' }
    }

    const battlePassRaw = { key: BATTLEPASS_KEY, previous: prevBattlePassRaw }
    const signinRaw = { key: SIGNIN_KEY, previous: prevSigninRaw }

    // 候选应用（失败 → 内存回滚，零持久化，不重试）。
    try {
      todaySigned.value = true
      lastSigninDate.value = today
      consecutiveDays.value = nextConsecutiveDays
      totalSignins.value = nextTotalSignins

      if (reward.type === 'gold') {
        playerStore.applyGoldRewardInMemory(reward.amount)
      } else {
        playerStore.addDiamond(reward.amount)
      }
    } catch {
      rollbackMemory()
      return { ok: false, reason: 'persistence failed' }
    }

    // 持久化顺序：金币路径 战令 key → 签到 key → 主存档；钻石路径 签到 key → 主存档。
    if (reward.type === 'gold') {
      try {
        playerStore.saveBattlePassData()
      } catch {
        return finalizeFailure([])
      }
    }

    try {
      save()
    } catch {
      return finalizeFailure(reward.type === 'gold' ? [battlePassRaw] : [])
    }

    let saved: boolean
    try {
      saved = playerStore.saveGame()
    } catch {
      return finalizeFailure(reward.type === 'gold' ? [battlePassRaw, signinRaw] : [signinRaw])
    }
    if (!saved) {
      return finalizeFailure(reward.type === 'gold' ? [battlePassRaw, signinRaw] : [signinRaw])
    }

    return { ok: true, reward }
  }

  function canSignin(): boolean {
    return !todaySigned.value
  }

  load()
  return { todaySigned, consecutiveDays, lastSigninDate, totalSignins, signin, canSignin }
})
