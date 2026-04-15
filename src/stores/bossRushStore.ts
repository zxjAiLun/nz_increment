import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { BOSS_RUSH_BOSSES, type BossRushEntry, type BossRushScore } from '../data/bossRush'

export const useBossRushStore = defineStore('bossRush', () => {
  const currentBossIndex = ref(0)
  const isActive = ref(false)
  const startTime = ref(0)
  const scores = ref<BossRushScore[]>([])
  const totalScore = computed(() => scores.value.reduce((sum, s) => sum + s.score, 0))

  function startBossRush() {
    isActive.value = true
    currentBossIndex.value = 0
    startTime.value = Date.now()
    scores.value = []
  }

  function recordClear(damageDealt: number, comboCount: number) {
    const elapsed = Math.floor((Date.now() - startTime.value) / 1000)
    const boss = BOSS_RUSH_BOSSES[currentBossIndex.value]
    // Score formula: base - time bonus + combo bonus + damage bonus
    const score = Math.floor(
      1000 * boss.difficulty - elapsed * 2 + comboCount * 50 + damageDealt * 0.01
    )
    scores.value.push({ bossId: boss.bossId, clearTime: elapsed, damageDealt, comboCount, score })
    currentBossIndex.value++
    return currentBossIndex.value < BOSS_RUSH_BOSSES.length
  }

  function getCurrentBoss(): BossRushEntry | null {
    if (currentBossIndex.value >= BOSS_RUSH_BOSSES.length) return null
    return BOSS_RUSH_BOSSES[currentBossIndex.value]
  }

  function endBossRush() {
    isActive.value = false
  }

  return { currentBossIndex, isActive, startTime, scores, totalScore, startBossRush, recordClear, getCurrentBoss, endBossRush }
})
