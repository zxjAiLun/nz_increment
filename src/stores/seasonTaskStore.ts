import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface SeasonTask {
  id: string
  name: string
  description: string
  target: number
  current: number
  expReward: number
  completed: boolean
}

export const useSeasonTaskStore = defineStore('seasonTask', () => {
  const tasks = ref<SeasonTask[]>([
    { id: 'kill_1000', name: '怪物猎手', description: '累计击杀1000怪物', target: 1000, current: 0, expReward: 500, completed: false },
    { id: 'clear_100', name: '征战者', description: '累计通关100次', target: 100, current: 0, expReward: 800, completed: false },
    { id: 'gold_50000', name: '理财专家', description: '累计获取50000金币', target: 50000, current: 0, expReward: 300, completed: false },
    { id: 'boss_20', name: 'Boss克星', description: '累计击杀20个Boss', target: 20, current: 0, expReward: 1000, completed: false },
    { id: 'combo_50', name: '连击达人', description: '单次战斗达成50连击', target: 50, current: 0, expReward: 600, completed: false },
  ])

  function updateProgress(taskId: string, amount: number) {
    const task = tasks.value.find((t: SeasonTask) => t.id === taskId)
    if (!task || task.completed) return
    task.current = Math.min(task.current + amount, task.target)
    if (task.current >= task.target) {
      task.completed = true
    }
  }

  function claimTask(taskId: string): number {
    const task = tasks.value.find((t: SeasonTask) => t.id === taskId)
    if (!task || !task.completed) return 0
    return task.expReward
  }

  return { tasks, updateProgress, claimTask }
})
