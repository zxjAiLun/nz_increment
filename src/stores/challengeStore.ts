/**
 * 每日/每周挑战 Store
 * 
 * 负责：生成、重置、进度追踪、奖励发放
 * 
 * @module challengeStore
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePlayerStore } from './playerStore'
import { useTalentStore } from './talentStore'
import type { AchievementReward } from '../types'

const DAILY_KEY = 'nz_daily_challenges_v1'
const WEEKLY_KEY = 'nz_weekly_challenges_v1'
// Phase 3.74：补偿事务涉及的外部 raw key（与 playerStore/talentStore 内部常量保持一致）。
const BATTLEPASS_KEY = 'nz_battlepass_v1'
const TALENT_KEY = 'nz_talent_tree_v2'
const MAIN_KEY = 'lollipop_adventure_save'

export interface Challenge {
  id: string
  name: string
  description: string
  target: number
  progress: number
  reward: AchievementReward
  resetAt: number
  type: 'daily' | 'weekly'
  /** 是否已完成（已领取奖励） */
  completed: boolean
}

function tomorrowReset(): number {
  const t = new Date()
  t.setDate(t.getDate() + 1)
  t.setHours(0, 0, 0, 0)
  return t.getTime()
}

function nextWeekReset(): number {
  const t = new Date()
  t.setDate(t.getDate() + (7 - t.getDay()))
  t.setHours(0, 0, 0, 0)
  return t.getTime()
}

const DAILY_TEMPLATES: Omit<Challenge, 'progress' | 'resetAt' | 'type' | 'completed'>[] = [
  { id: 'daily_kill_50',    name: '每日击杀',   description: '击杀50只怪物',   target: 50,    reward: { gold: 1000 } },
  { id: 'daily_kill_100',   name: '每日猎手',   description: '击杀100只怪物',  target: 100,   reward: { diamond: 5 } },
  { id: 'daily_gold_10k',   name: '每日赚金',   description: '累计获得10K金币', target: 10000, reward: { gold: 2000 } },
  { id: 'daily_training_20',name: '每日修炼',   description: '练功房击杀20只',  target: 20,    reward: { exp: 500 } },
]

const WEEKLY_TEMPLATES: Omit<Challenge, 'progress' | 'resetAt' | 'type' | 'completed'>[] = [
  { id: 'weekly_kill_1000',   name: '每周击杀',   description: '击杀1000只怪物',   target: 1000,   reward: { diamond: 50 } },
  { id: 'weekly_kill_5000',   name: '每周猎手',   description: '击杀5000只怪物',   target: 5000,   reward: { gold: 50000, diamond: 20 } },
  { id: 'weekly_training_500', name: '每周修炼',   description: '练功房击杀500只',   target: 500,    reward: { passive: 1 } },
  { id: 'weekly_gold_1m',     name: '每周赚金',   description: '累计获得1M金币',    target: 1000000, reward: { gold: 200000 } },
]

export const useChallengeStore = defineStore('challenge', () => {
  const dailyChallenges = ref<Challenge[]>([])
  const weeklyChallenges = ref<Challenge[]>([])

  const allChallenges = computed(() => [...dailyChallenges.value, ...weeklyChallenges.value])

  function generateDaily(): Challenge[] {
    return DAILY_TEMPLATES.map(t => ({
      ...t,
      progress: 0,
      resetAt: tomorrowReset(),
      type: 'daily' as const,
      completed: false
    }))
  }

  function generateWeekly(): Challenge[] {
    return WEEKLY_TEMPLATES.map(t => ({
      ...t,
      progress: 0,
      resetAt: nextWeekReset(),
      type: 'weekly' as const,
      completed: false
    }))
  }

  function load() {
    const now = Date.now()

    // Daily
    try {
      const saved = localStorage.getItem(DAILY_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Challenge[]
        const expired = parsed.filter(c => c.resetAt <= now)
        if (expired.length > 0) {
          dailyChallenges.value = generateDaily()
        } else {
          dailyChallenges.value = parsed
        }
      } else {
        dailyChallenges.value = generateDaily()
      }
    } catch {
      dailyChallenges.value = generateDaily()
    }

    // Weekly
    try {
      const saved = localStorage.getItem(WEEKLY_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Challenge[]
        const expired = parsed.filter(c => c.resetAt <= now)
        if (expired.length > 0) {
          weeklyChallenges.value = generateWeekly()
        } else {
          weeklyChallenges.value = parsed
        }
      } else {
        weeklyChallenges.value = generateWeekly()
      }
    } catch {
      weeklyChallenges.value = generateWeekly()
    }

    save()
  }

  function save() {
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyChallenges.value))
    localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyChallenges.value))
  }

  /** 增加指定类型的挑战进度 */
  function incrementProgress(type: 'kill' | 'trainingKill' | 'gold', amount: number) {
    const now = Date.now()

    for (const c of dailyChallenges.value) {
      if (c.resetAt <= now || c.completed) continue
      if (c.id.startsWith('daily_kill') && type === 'kill') {
        c.progress = Math.min(c.progress + amount, c.target)
      } else if (c.id.startsWith('daily_training') && type === 'trainingKill') {
        c.progress = Math.min(c.progress + amount, c.target)
      } else if (c.id.startsWith('daily_gold') && type === 'gold') {
        c.progress = Math.min(c.progress + amount, c.target)
      }
    }

    for (const c of weeklyChallenges.value) {
      if (c.resetAt <= now || c.completed) continue
      if (c.id.startsWith('weekly_kill') && type === 'kill') {
        c.progress = Math.min(c.progress + amount, c.target)
      } else if (c.id.startsWith('weekly_training') && type === 'trainingKill') {
        c.progress = Math.min(c.progress + amount, c.target)
      } else if (c.id.startsWith('weekly_gold') && type === 'gold') {
        c.progress = Math.min(c.progress + amount, c.target)
      }
    }

    save()
  }

  /**
   * Phase 3.74：将一次 checkCompletion 中所有符合资格的 daily/weekly challenge 作为一个补偿事务。
   *
   * 资格与奖励候选（单次 timestamp）→ 内存与 raw 快照 → 全部奖励纯内存应用 → completed 标记
   * → 固定顺序持久化（BattlePass → Talent → Player main → Daily → Weekly）→ 任一点失败完整回滚与补偿。
   *
   * 消除：奖励已持久化但 challenge 未完成 / challenge 已完成但 Player 主存档未持久化 /
   * daily 成功 weekly 失败 / 失败后重试重复发奖。
   */
  function checkCompletion(options?: { now?: number }): Challenge[] {
    // Phase 3.74 Repair 1 — P1-1：时间与空候选门前置，零依赖 Store 初始化 / 零 storage。
    // 1) 解析并校验 transactionTimestamp（options.now 优先，缺省仅一次 Date.now）。
    let transactionTimestamp: number
    try {
      transactionTimestamp = options?.now ?? Date.now()
    } catch {
      return []
    }
    if (!Number.isSafeInteger(transactionTimestamp) || transactionTimestamp <= 0) return []

    // 2) 仅从 Challenge state 构造 eligible（顺序 daily → weekly），不涉及任何 Store / storage。
    const eligible: { challenge: Challenge; reward: NonNullable<Challenge['reward']> }[] = []
    for (const list of [dailyChallenges.value, weeklyChallenges.value]) {
      for (const c of list) {
        if (c.resetAt <= transactionTimestamp || c.completed) continue
        if (c.progress >= c.target) eligible.push({ challenge: c, reward: c.reward })
      }
    }
    if (eligible.length === 0) return []

    // 3) 推导涉及的持久化 key（每个相关 key 至多保存一次）。
    let hasGold = false
    let hasDiamond = false
    let hasExp = false
    for (const { reward } of eligible) {
      if (reward.gold) hasGold = true
      if (reward.diamond) hasDiamond = true
      if (reward.exp) hasExp = true
    }

    // 4) 延迟获取依赖 Store；任一初始化异常不得逃出公开 action。
    let playerStore: ReturnType<typeof usePlayerStore>
    let talentStore: ReturnType<typeof useTalentStore>
    try {
      playerStore = usePlayerStore()
      talentStore = useTalentStore()
    } catch {
      return []
    }

    // 5) 内存快照（精确覆盖 challenge / player / battlePass / talent）。
    // player/battlePass 均可 JSON 序列化（saveGame 即 JSON.stringify），深克隆即完整快照；
    // 奖励可能改 battlePass.level / player.level / stats / unlockedPhases，必须全量回滚。
    const prevDailyCompleted = dailyChallenges.value.map(c => c.completed)
    const prevWeeklyCompleted = weeklyChallenges.value.map(c => c.completed)
    const snap = JSON.parse(JSON.stringify({
      p: playerStore.player,
      b: playerStore.battlePass,
      c: playerStore.lastOfflineCheckpointAt,
      t: talentStore.talentPoints,
    }))

    // raw 快照 + 持久化步骤：在 try 内读取所有 key 的 previous 值（mutation 前）；
    // getItem 抛错 → 空数组、零修改、零写盘。
    let steps: [boolean, () => void, string, string | null][]
    try {
      steps = [
        [hasGold || hasExp, () => playerStore.saveBattlePassData(), BATTLEPASS_KEY, localStorage.getItem(BATTLEPASS_KEY)],
        [hasExp, () => talentStore.saveTalentData(), TALENT_KEY, localStorage.getItem(TALENT_KEY)],
        [hasGold || hasDiamond || hasExp, () => {
          if (!playerStore.saveGame(transactionTimestamp)) throw new Error()
        }, MAIN_KEY, localStorage.getItem(MAIN_KEY)],
        [true, () => localStorage.setItem(DAILY_KEY, JSON.stringify(dailyChallenges.value)), DAILY_KEY, localStorage.getItem(DAILY_KEY)],
        [true, () => localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyChallenges.value)), WEEKLY_KEY, localStorage.getItem(WEEKLY_KEY)],
      ]
    } catch {
      return []
    }

    // 内存回滚：完整恢复 challenge / player / battlePass / talent。
    function rollbackMemory() {
      dailyChallenges.value.forEach((c, i) => { c.completed = prevDailyCompleted[i] })
      weeklyChallenges.value.forEach((c, i) => { c.completed = prevWeeklyCompleted[i] })
      Object.assign(playerStore.player, snap.p)
      Object.assign(playerStore.battlePass, snap.b)
      playerStore.lastOfflineCheckpointAt = snap.c
      talentStore.talentPoints = snap.t
    }

    // 6) 纯内存应用奖励（每条约分别应用，不合并后再 floor；按 gold → diamond → exp 顺序）。
    // P1-2：统一异常边界——任一步抛错 → rollbackMemory → 不进入任何持久化/补偿（尚无成功写入）→ [].
    try {
      for (const { challenge, reward } of eligible) {
        if (reward.gold) playerStore.applyGoldRewardInMemory(reward.gold)
        if (reward.diamond) playerStore.applyDiamondRewardInMemory(reward.diamond)
        if (reward.exp) playerStore.applyExperienceRewardInMemory(reward.exp)
        challenge.completed = true
      }
    } catch {
      rollbackMemory()
      return []
    }

    // 固定持久化顺序：BattlePass → Talent → Player main → Daily → Weekly。
    // Talent 在存在 exp 奖励时统一落盘（applyExperienceRewardInMemory 经 checkLevelUp 可能改变 talent points，
    // 即便未升级也属幂等写入，不影响“每 key 至多一次”）。
    const writtenRaws: [string, string | null][] = []
    for (const [cond, fn, key, previous] of steps) {
      if (!cond) continue
      try {
        fn()
        writtenRaws.push([key, previous])
      } catch {
        rollbackMemory()
        let failed = false
        for (let i = writtenRaws.length - 1; i >= 0; i--) {
          const k = writtenRaws[i][0]
          const p = writtenRaws[i][1]
          try {
            if (p === null) localStorage.removeItem(k)
            else localStorage.setItem(k, p)
          } catch {
            failed = true
          }
        }
        if (failed) throw new Error('challenge completion persistence rollback failed')
        return []
      }
    }

    return eligible.map(e => e.challenge)
  }

  /** 获取某类挑战当前进度描述 */
  function getProgressText(type: 'kill' | 'trainingKill' | 'gold'): string {
    const now = Date.now()
    const relevant = allChallenges.value.filter(c => {
      if (c.resetAt <= now || c.completed) return false
      if (type === 'kill') return c.id.includes('kill') && !c.id.includes('training')
      if (type === 'trainingKill') return c.id.includes('training')
      if (type === 'gold') return c.id.includes('gold')
      return false
    })
    if (relevant.length === 0) return ''
    return relevant.map(c => `${c.name}: ${c.progress}/${c.target}`).join(' | ')
  }

  /** 根据ID查找挑战（ChallengePanel 兼容） */
  function getChallenge(id: string): Challenge | undefined {
    return allChallenges.value.find(c => c.id === id)
  }

  /** 领取奖励（ChallengePanel 兼容：直接调用 checkCompletion 触发发放） */
  function claimReward(_id: string) {
    checkCompletion()
    return null
  }

  /** 返回 Reward 转 { type, amount } 格式（用于 UI 显示） */
  function getRewardEntry(reward: AchievementReward): { type: string; amount: number } | null {
    if (reward.gold) return { type: 'gold', amount: reward.gold }
    if (reward.diamond) return { type: 'diamond', amount: reward.diamond }
    if (reward.exp) return { type: 'exp', amount: reward.exp }
    if (reward.passive) return { type: 'passive', amount: reward.passive }
    if (reward.equipmentTicket) return { type: 'equipmentTicket', amount: reward.equipmentTicket }
    if (reward.legendaryEquipment) return { type: 'legendaryEquipment', amount: reward.legendaryEquipment }
    if (reward.goldBonus) return { type: 'goldBonus', amount: reward.goldBonus }
    return null
  }

  load()

  return {
    dailyChallenges,
    weeklyChallenges,
    allChallenges,
    load,
    incrementProgress,
    checkCompletion,
    getProgressText,
    getChallenge,
    claimReward,
    getRewardEntry
  }
})
