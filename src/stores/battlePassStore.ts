import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { BATTLE_PASS_REWARDS, type BattlePassReward } from '../data/battlePassRewards'

export { type BattlePassReward }

const BATTLE_PASS_KEY = 'nz_battle_pass'

function loadState() {
  try {
    const saved = localStorage.getItem(BATTLE_PASS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveState(state: any) {
  try { localStorage.setItem(BATTLE_PASS_KEY, JSON.stringify(state)) } catch {}
}

export const useBattlePassStore = defineStore('battlePass', () => {
  const saved = loadState()
  const currentLevel = ref(saved?.currentLevel ?? 1)
  const totalExp = ref(saved?.totalExp ?? 0)
  const expToNextLevel = ref(saved?.expToNextLevel ?? 100)
  const isPremium = ref(saved?.isPremium ?? false)
  const claimedLevels = ref<number[]>(saved?.claimedLevels ?? [])
  const seasonStartTime = ref(saved?.seasonStartTime ?? Date.now())
  const seasonDaysLeft = ref(saved?.seasonDaysLeft ?? 60)

  // Persist on change
  watch([currentLevel, totalExp, isPremium, claimedLevels], () => {
    saveState({
      currentLevel: currentLevel.value,
      totalExp: totalExp.value,
      expToNextLevel: expToNextLevel.value,
      isPremium: isPremium.value,
      claimedLevels: claimedLevels.value,
      seasonStartTime: seasonStartTime.value,
      seasonDaysLeft: seasonDaysLeft.value
    })
  })

  function expRequiredForLevel(level: number): number {
    return Math.floor(100 * Math.pow(1.15, level - 1))
  }

  function setPremium(value: boolean) {
    isPremium.value = value
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
    if (currentLevel.value < level) return null  // Level prerequisite
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (reward.premium && !isPremium.value) return null
    claimedLevels.value.push(level)
    return reward
  }

  return {
    currentLevel, totalExp, expToNextLevel, isPremium, claimedLevels,
    seasonStartTime, seasonDaysLeft, addExp, claimLevelReward, setPremium
  }
})
