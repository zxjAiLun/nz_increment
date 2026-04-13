import { defineStore } from 'pinia'
import { ref } from 'vue'
import { generateDailyChallenges, generateWeeklyChallenges } from '../utils/challengeGenerator'
import type { Challenge, ChallengeProgress, ChallengeCondition } from '../types/challenge'

export const useChallengeStore = defineStore('challenge', () => {
  const dailyChallenges = ref<Challenge[]>(generateDailyChallenges())
  const weeklyChallenges = ref<Challenge[]>(generateWeeklyChallenges())
  const progress = ref<ChallengeProgress[]>([])

  function initProgress() {
    const all = [...dailyChallenges.value, ...weeklyChallenges.value]
    progress.value = all.map(c => ({
      challengeId: c.id,
      progress: 0,
      completed: false,
      claimed: false
    }))
  }

  function updateProgress(type: ChallengeCondition['type'], value: number) {
    const allChallenges = [...dailyChallenges.value, ...weeklyChallenges.value]
    for (const p of progress.value) {
      const challenge = allChallenges.find(c => c.id === p.challengeId)
      if (challenge && challenge.condition.type === type) {
        p.progress = Math.min(p.progress + value, challenge.condition.target)
        if (p.progress >= challenge.condition.target) {
          p.completed = true
        }
      }
    }
  }

  function claimReward(challengeId: string): Challenge['reward'] | null {
    const p = progress.value.find(p => p.challengeId === challengeId)
    if (!p || !p.completed || p.claimed) return null
    p.claimed = true
    const allChallenges = [...dailyChallenges.value, ...weeklyChallenges.value]
    return allChallenges.find(c => c.id === challengeId)?.reward ?? null
  }

  function getProgress(challengeId: string): ChallengeProgress | undefined {
    return progress.value.find(p => p.challengeId === challengeId)
  }

  // T98 获取周挑战刷新时间
  function getWeeklyResetTime(): number {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
    return now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000
  }

  // T98 扩展每周挑战
  const EXTENDED_WEEKLY_TASKS = [
    { id: 'weekly_boss_10', name: 'Boss猎人', description: '击杀10个世界Boss', reward: { diamond: 50 } },
    { id: 'weekly_arena_20', name: '竞技场冲刺', description: '在竞技场获得20场胜利', reward: { diamond: 80 } },
    { id: 'weekly_dungeon_30', name: '地下城探险', description: '通关30层地下城', reward: { gold: 10000 } },
    { id: 'weekly_trade_5', name: '交易达人', description: '完成5次交易', reward: { diamond: 30 } },
  ]

  return {
    dailyChallenges,
    weeklyChallenges,
    progress,
    initProgress,
    updateProgress,
    claimReward,
    getProgress
  }
})
