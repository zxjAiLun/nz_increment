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
import type { AchievementReward } from '../types'

const DAILY_KEY = 'nz_daily_challenges_v1'
const WEEKLY_KEY = 'nz_weekly_challenges_v1'

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

  /** 检查挑战完成状态并发放奖励，返回完成的挑战列表 */
  function checkCompletion(): Challenge[] {
    const playerStore = usePlayerStore()
    const completed: Challenge[] = []
    const now = Date.now()

    for (const c of allChallenges.value) {
      if (c.resetAt <= now || c.completed) continue
      if (c.progress >= c.target) {
        if (c.reward.gold) playerStore.addGold(c.reward.gold)
        if (c.reward.diamond) playerStore.addDiamond(c.reward.diamond)
        if (c.reward.exp) playerStore.addExperience(c.reward.exp)
        c.completed = true
        completed.push(c)
      }
    }

    if (completed.length > 0) save()
    return completed
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
