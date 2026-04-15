import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ACHIEVEMENT_STORIES } from '../data/achievementStories'
import type { AchievementStory } from '../data/achievementStories'

export const useAchievementStoryStore = defineStore('achievementStory', () => {
  const unlockedStories = ref<string[]>([])

  function checkAndUnlockStories(progress: { killCount?: number; goldEarned?: number; floorReached?: number }) {
    for (const story of ACHIEVEMENT_STORIES) {
      if (unlockedStories.value.includes(story.id)) continue

      let current = 0
      if (story.achievementId === 'kill_count') current = progress.killCount || 0
      else if (story.achievementId === 'gold_earned') current = progress.goldEarned || 0
      else if (story.achievementId === 'floor_reached') current = progress.floorReached || 0

      if (current >= story.unlocksAt) {
        unlockedStories.value.push(story.id)
      }
    }
  }

  function getStoryProgress(story: AchievementStory): { current: number; target: number } {
    // placeholder - actual tracking would connect to playerStore
    return { current: 0, target: story.unlocksAt }
  }

  function isUnlocked(storyId: string): boolean {
    return unlockedStories.value.includes(storyId)
  }

  return { unlockedStories, checkAndUnlockStories, getStoryProgress, isUnlocked }
})
