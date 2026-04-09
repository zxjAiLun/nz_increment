import { defineStore } from 'pinia'
import { ref } from 'vue'
import { BATTLE_PASS_REWARDS, type BattlePassReward } from '../data/battlePassRewards'

export { type BattlePassReward }

export const useBattlePassStore = defineStore('battlePass', () => {
  const currentLevel = ref(1)
  const totalExp = ref(0)
  const expToNextLevel = ref(100)
  const isPremium = ref(false)
  const claimedLevels = ref<number[]>([])
  const seasonStartTime = ref(Date.now())
  const seasonDaysLeft = ref(60)

  // 战令等级 1-50 的经验需求
  function expRequiredForLevel(level: number): number {
    return Math.floor(100 * Math.pow(1.15, level - 1))
  }

  function addExp(amount: number) {
    totalExp.value += amount
    while (totalExp.value >= expToNextLevel.value && currentLevel.value < 50) {
      totalExp.value -= expToNextLevel.value
      currentLevel.value++
      expToNextLevel.value = expRequiredForLevel(currentLevel.value)
    }
  }

  function claimLevelReward(level: number): BattlePassReward | null {
    if (claimedLevels.value.includes(level)) return null
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (reward.premium && !isPremium.value) return null
    claimedLevels.value.push(level)
    return reward
  }

  return {
    currentLevel, totalExp, expToNextLevel, isPremium, claimedLevels,
    seasonStartTime, seasonDaysLeft, addExp, claimLevelReward
  }
})
