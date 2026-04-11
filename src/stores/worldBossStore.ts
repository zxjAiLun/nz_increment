import { defineStore } from 'pinia'
import { ref } from 'vue'
import { WORLD_BOSSES, type WorldBoss } from '../data/worldBoss'

export const useWorldBossStore = defineStore('worldBoss', () => {
  const currentBoss = ref<WorldBoss | null>(null)
  const bossHp = ref(0)
  const totalDamage = ref(0)
  const myContribution = ref(0)
  const challengeTickets = ref(3) // 初始3张挑战券
  const damageRankings = ref<{ playerId: string; name: string; damage: number }[]>([])
  const isDefeated = ref(false)

  function spawnBoss(bossId: string) {
    const boss = WORLD_BOSSES.find((b) => b.id === bossId)
    if (!boss) return
    currentBoss.value = boss
    bossHp.value = boss.maxHp
    totalDamage.value = 0
    myContribution.value = 0
    isDefeated.value = false
  }

  function attackBoss(damage: number): number {
    if (!currentBoss.value || isDefeated.value) return 0
    bossHp.value = Math.max(0, bossHp.value - damage)
    totalDamage.value += damage
    myContribution.value += damage

    if (bossHp.value <= 0) {
      isDefeated.value = true
      return currentBoss.value.rewards.diamond
    }
    return 0
  }

  function useTicket(): boolean {
    if (challengeTickets.value <= 0) return false
    challengeTickets.value--
    return true
  }

  function addTickets(count: number) {
    challengeTickets.value += count
  }

  function getBossHpPercent(): number {
    if (!currentBoss.value) return 0
    return Math.floor((bossHp.value / currentBoss.value.maxHp) * 100)
  }

  function getMyRank(): number {
    const sorted = [...damageRankings.value].sort((a, b) => b.damage - a.damage)
    return sorted.findIndex((r) => r.damage === myContribution.value) + 1
  }

  return {
    currentBoss,
    bossHp,
    totalDamage,
    myContribution,
    challengeTickets,
    damageRankings,
    isDefeated,
    spawnBoss,
    attackBoss,
    useTicket,
    addTickets,
    getBossHpPercent,
    getMyRank,
  }
})
