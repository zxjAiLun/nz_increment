import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { BATTLE_PASS_REWARDS, type BattlePassReward } from '../data/battlePassRewards'

export { type BattlePassReward }

export interface BattlePassRewardItem {
  type: string
  amount: number
}

const BATTLE_PASS_KEY = 'nz_battle_pass'

function loadState() {
  try {
    const saved = localStorage.getItem(BATTLE_PASS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveState(state: any): boolean {
  try {
    localStorage.setItem(BATTLE_PASS_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const useBattlePassStore = defineStore('battlePass', () => {
  const saved = loadState()
  const currentLevel = ref(saved?.currentLevel ?? 1)
  const totalExp = ref(saved?.totalExp ?? 0)
  const expToNextLevel = ref(saved?.expToNextLevel ?? 100)
  const isPremium = ref(saved?.isPremium ?? false)
  // Phase 3.80：free / premium 两轨独立 marker。legacy claimedLevels 迁移：
  // 旧实现对 Premium 用户一次 claim 同时发两轨，故旧值同时视为 free + premium claimed，
  // 优先避免旧用户重复领取；新字段存在时优先用新字段，legacy 不得覆盖。
  const claimedFreeLevels = ref<number[]>(
    Array.isArray(saved?.claimedFreeLevels)
      ? [...saved.claimedFreeLevels]
      : Array.isArray(saved?.claimedLevels)
        ? [...saved.claimedLevels]
        : []
  )
  const claimedPremiumLevels = ref<number[]>(
    Array.isArray(saved?.claimedPremiumLevels)
      ? [...saved.claimedPremiumLevels]
      : Array.isArray(saved?.claimedLevels)
        ? [...saved.claimedLevels]
        : []
  )
  const seasonStartTime = ref(saved?.seasonStartTime ?? Date.now())
  const seasonDaysLeft = ref(saved?.seasonDaysLeft ?? 60)

  // 新保存格式：只写两轨，不再产生 legacy claimedLevels。
  function persistState() {
    return {
      currentLevel: currentLevel.value,
      totalExp: totalExp.value,
      expToNextLevel: expToNextLevel.value,
      isPremium: isPremium.value,
      claimedFreeLevels: claimedFreeLevels.value,
      claimedPremiumLevels: claimedPremiumLevels.value,
      seasonStartTime: seasonStartTime.value,
      seasonDaysLeft: seasonDaysLeft.value
    }
  }

  // Persist on change（level/exp/premium 等；claim 路径不依赖本 watch，另有显式同步保存）
  watch([currentLevel, totalExp, isPremium, claimedFreeLevels, claimedPremiumLevels], () => {
    saveState(persistState())
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

  // Phase 3.80：显式 track claim。只返回被点击那一轨的奖励 item；track marker
  // 必须先经 nz_battle_pass 同步保存成功才保留，保存失败精确回滚 marker 并返回 null。
  function claimLevelReward(level: number, track: 'free' | 'premium'): BattlePassRewardItem | null {
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (currentLevel.value < level) return null  // Level prerequisite
    const item = track === 'free' ? reward.free : reward.premium
    if (!item) return null
    if (track === 'premium' && !isPremium.value) return null
    const markers = track === 'free' ? claimedFreeLevels : claimedPremiumLevels
    if (markers.value.includes(level)) return null
    markers.value.push(level)
    if (!saveState(persistState())) {
      markers.value = markers.value.filter(l => l !== level)
      return null
    }
    return { type: item.type, amount: item.amount }
  }

  return {
    currentLevel, totalExp, expToNextLevel, isPremium,
    claimedFreeLevels, claimedPremiumLevels,
    seasonStartTime, seasonDaysLeft, addExp, claimLevelReward, setPremium
  }
})
