import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GuildWar } from '../data/guildWar'
import { useGuildStore } from './guildStore'

export const useGuildWarStore = defineStore('guildWar', () => {
  const currentWar = ref<GuildWar | null>(null)
  const warHistory = ref<GuildWar[]>([])
  const signupOpen = ref(true)
  const rewards = ref<{ rank: number; reward: { diamond?: number; gold?: number } }[]>([
    { rank: 1, reward: { diamond: 500, gold: 10000 } },
    { rank: 2, reward: { diamond: 300, gold: 5000 } },
    { rank: 3, reward: { diamond: 100, gold: 2000 } },
  ])

  function signup(): boolean {
    if (!signupOpen.value) return false
    signupOpen.value = false
    if (currentWar.value) currentWar.value.status = 'matching'
    return true
  }

  function startWar(opponentGuildId: string) {
    const guildStore = useGuildStore()
    currentWar.value = {
      id: `war_${Date.now()}`,
      guildId: guildStore.currentGuild?.id || 'guild_1',
      opponentGuildId,
      status: 'fighting',
      startTime: Date.now(),
      endTime: Date.now() + 30 * 60 * 1000,
      score: { guild: 0, opponent: 0 }
    }
  }

  function addScore(guildId: 'guild' | 'opponent', points: number) {
    if (!currentWar.value) return
    if (guildId === 'guild') currentWar.value.score.guild += points
    else currentWar.value.score.opponent += points
  }

  function endWar(): 'win' | 'lose' | 'draw' {
    if (!currentWar.value) return 'draw'
    const { guild, opponent } = currentWar.value.score
    currentWar.value.status = 'finished'
    warHistory.value.unshift(currentWar.value)
    if (guild > opponent) return 'win'
    if (guild < opponent) return 'lose'
    return 'draw'
  }

  return { currentWar, warHistory, signupOpen, rewards, signup, startWar, addScore, endWar }
})
