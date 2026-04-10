import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MASTER_TASKS } from '../data/masterTasks'
import type { MasterApprentice, MasterTask } from '../types/master'

export const useMasterStore = defineStore('master', () => {
  const masterData = ref<MasterApprentice>({ role: null, apprenticeIds: [], teachingPower: 0, graduationProgress: 0, rewardsClaimed: [] })

  const tasks = ref<{ [key: string]: { progress: number; completed: boolean } }>({})

  function becomeMaster() {
    masterData.value.role = 'master'
  }

  function becomeApprentice(masterId: string) {
    masterData.value.role = 'apprentice'
    masterData.value.masterId = masterId
  }

  function updateTaskProgress(taskId: string, amount: number) {
    const taskMeta = MASTER_TASKS.find(t => t.id === taskId)
    if (!taskMeta) return
    if (!tasks.value[taskId]) tasks.value[taskId] = { progress: 0, completed: false }
    tasks.value[taskId].progress += amount
    if (tasks.value[taskId].progress >= taskMeta.target) {
      tasks.value[taskId].completed = true
      masterData.value.graduationProgress++
    }
  }

  function claimReward(taskId: string): MasterTask['reward'] | null {
    if (tasks.value[taskId]?.completed && !masterData.value.rewardsClaimed.includes(taskId)) {
      masterData.value.rewardsClaimed.push(taskId)
      return MASTER_TASKS.find(t => t.id === taskId)?.reward || null
    }
    return null
  }

  function graduate(): boolean {
    // 出师需要至少完成3个任务
    const completedCount = Object.values(tasks.value).filter(t => t.completed).length
    if (completedCount >= 3) {
      masterData.value.role = null
      return true
    }
    return false
  }

  return { masterData, tasks, becomeMaster, becomeApprentice, updateTaskProgress, claimReward, graduate }
})
