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
