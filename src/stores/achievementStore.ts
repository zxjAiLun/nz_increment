import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ACHIEVEMENTS } from '../data/achievements'
import type { Achievement, AchievementCategory, AchievementCondition } from '../types/achievement'
import { usePlayerStore } from './playerStore'

export const useAchievementStore = defineStore('achievement', () => {
  const unlocked = ref<Set<string>>(new Set())
  const recentlyUnlocked = ref<string[]>([]) // 最多显示5个

  function checkAchievement(type: AchievementCondition['type'], value: number) {
    for (const ach of ACHIEVEMENTS) {
      if (ach.unlockedAt) continue
      if (ach.condition.type !== type) continue
      if (value >= ach.condition.target) {
        unlock(ach.id)
      }
    }
  }

  function unlock(achievementId: string) {
    const ach = ACHIEVEMENTS.find(a => a.id === achievementId)
    if (!ach || unlocked.value.has(achievementId)) return
    ach.unlockedAt = Date.now()
    unlocked.value.add(achievementId)
    recentlyUnlocked.value.unshift(achievementId)
    if (recentlyUnlocked.value.length > 5) recentlyUnlocked.value.pop()
    // Distribute rewards
    const playerStore = usePlayerStore()
    if (ach.reward.diamond) playerStore.addDiamond(ach.reward.diamond)
    if (ach.reward.title) playerStore.player.title = ach.reward.title
    if (ach.reward.avatarFrame) playerStore.player.ownedAvatarFrames.push(ach.reward.avatarFrame)
  }

  function getByCategory(cat: AchievementCategory): Achievement[] {
    return ACHIEVEMENTS.filter(a => a.category === cat)
  }

  function isUnlocked(id: string): boolean {
    return unlocked.value.has(id) || ACHIEVEMENTS.find(a => a.id === id)?.unlockedAt !== undefined
  }

  return { unlocked, recentlyUnlocked, checkAchievement, unlock, getByCategory, isUnlocked }
})
