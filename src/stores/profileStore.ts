import { defineStore } from 'pinia'
import { computed } from 'vue'
import { usePlayerStore } from './playerStore'
import { useGameStore } from './gameStore'
import { useAchievementStore } from './achievementStore'
import { useTitleStore } from './titleStore'
import type { PlayerProfile } from '../data/playerProfile'

// Extended player type for profile fields not yet in core Player interface
interface ExtendedPlayer {
  createdAt?: string
  totalBattles?: number
  victories?: number
  totalGoldEarned?: number
  bossKillCount?: number
  avatarFrame?: string
}

export const useProfileStore = defineStore('profile', () => {
  const playerStore = usePlayerStore()
  const gameStore = useGameStore()
  const achievementStore = useAchievementStore()
  const titleStore = useTitleStore()

  const profile = computed<PlayerProfile>(() => {
    const player = playerStore.player as ExtendedPlayer
    return {
      playerName: playerStore.player.name,
      level: playerStore.player.level,
      title: playerStore.player.title || '无',
      joinDate: player.createdAt || new Date().toISOString(),
      stats: {
        totalBattles: player.totalBattles || 0,
        victories: player.victories || 0,
        defeat: (player.totalBattles || 0) - (player.victories || 0),
        winRate: player.totalBattles
          ? Math.round(((player.victories || 0) / player.totalBattles) * 100)
          : 0,
        totalDamage: gameStore.damageStats.totalDamage,
        totalGoldEarned: player.totalGoldEarned || 0,
        bossKills: player.bossKillCount || 0,
        daysPlayed: Math.floor((Date.now() - new Date(player.createdAt || Date.now()).getTime()) / 86400000) + 1,
      },
      achievements: [...achievementStore.unlocked],
      equippedTitle: titleStore.equippedTitle || '无',
      avatarFrame: player.avatarFrame || 'default',
    }
  })

  function exportProfile(): string {
    return JSON.stringify(profile.value, null, 2)
  }

  return { profile, exportProfile }
})
