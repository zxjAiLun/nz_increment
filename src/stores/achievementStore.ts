import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Achievement } from '../types'
import { createDefaultAchievements, checkAchievements, applyAchievementReward } from '../utils/achievementChecker'

export const useAchievementStore = defineStore('achievement', () => {
  const achievements = ref<Achievement[]>(createDefaultAchievements())
  const newlyCompletedAchievements = ref<Achievement[]>([])
  
  function checkAndUpdateAchievements(player: any) {
    const newlyCompleted = checkAchievements(player, achievements.value)
    
    for (const achievement of newlyCompleted) {
      applyAchievementReward(player, achievement)
      newlyCompletedAchievements.value.push(achievement)
    }
    
    return newlyCompleted
  }
  
  function clearNewlyCompleted() {
    newlyCompletedAchievements.value = []
  }
  
  function getAchievementsByCategory(category: string): Achievement[] {
    return achievements.value.filter(a => a.category === category)
  }
  
  function getCompletedCount(): number {
    return achievements.value.filter(a => a.completed).length
  }
  
  function resetAchievements() {
    achievements.value = createDefaultAchievements()
    newlyCompletedAchievements.value = []
  }
  
  return {
    achievements,
    newlyCompletedAchievements,
    checkAndUpdateAchievements,
    clearNewlyCompleted,
    getAchievementsByCategory,
    getCompletedCount,
    resetAchievements
  }
})
