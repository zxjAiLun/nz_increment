import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SIGNIN_REWARDS, SIGNIN_CYCLE } from '../data/signin'
import type { SigninReward } from '../data/signin'
import { usePlayerStore } from './playerStore'

const SIGNIN_KEY = 'nz_signin'

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
    const saved = localStorage.getItem(SIGNIN_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      todaySigned.value = data.todaySigned || false
      consecutiveDays.value = data.consecutiveDays || 0
      lastSigninDate.value = data.lastSigninDate || null
      totalSignins.value = data.totalSignins || 0
      // Reset if new day
      if (lastSigninDate.value !== getToday()) {
        todaySigned.value = false
      }
    }
  }

  function save() {
    localStorage.setItem(SIGNIN_KEY, JSON.stringify({
      todaySigned: todaySigned.value,
      consecutiveDays: consecutiveDays.value,
      lastSigninDate: lastSigninDate.value,
      totalSignins: totalSignins.value
    }))
  }

  function signin(): SigninReward | null {
    if (todaySigned.value) return null
    const today = getToday()
    const cycleDay = (consecutiveDays.value % SIGNIN_CYCLE) + 1
    const reward = SIGNIN_REWARDS[cycleDay - 1]

    todaySigned.value = true
    lastSigninDate.value = today
    consecutiveDays.value++
    totalSignins.value++
    save()

    // Distribute reward
    if (reward.type === 'gold') playerStore.addGold(reward.amount)
    else if (reward.type === 'diamond') playerStore.addDiamond(reward.amount)

    return reward
  }

  function canSignin(): boolean {
    return !todaySigned.value
  }

  load()
  return { todaySigned, consecutiveDays, totalSignins, signin, canSignin }
})
