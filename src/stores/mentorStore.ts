import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateId } from '../utils/calc'

// T68 师徒状态
export type MentorRelationStatus = 'active' | 'completed' | 'expired'

// T68 师徒关系
export interface MentorRelation {
  id: string
  mentorId: string
  mentorName: string
  apprenticeId: string
  apprenticeName: string
  status: MentorRelationStatus
  startDate: number
  endDate?: number        // 出师后结束
  mentorContribution: number   // 导师贡献点
  apprenticeProgress: number   // 学徒进度 0-100
  rewards: MentorReward[]
}

// T68 师徒奖励
export interface MentorReward {
  type: 'mentor' | 'apprentice'
  claimed: boolean
  condition: string
  reward: { gold?: number; diamond?: number; item?: string }
}

// T68 每日任务
export interface DailyTask {
  id: string
  description: string
  target: number
  progress: number
  completed: boolean
}

const STORAGE_KEY = 'nz_mentor_v1'
const MAX_MENTOR_COUNT = 3       // 导师最多带3个学徒
const COMPLETION_THRESHOLD = 100 // 出师所需进度
const DAILY_TASK_RESET = 24 * 60 * 60 * 1000

export const useMentorStore = defineStore('mentor', () => {
  const relations = ref<MentorRelation[]>([])
  const dailyTasks = ref<DailyTask[]>([])
  const pendingRequests = ref<MentorRelation[]>([]) // 待接受的拜师请求
  const lastTaskReset = ref(0)

  // T68 每日任务定义
  const DAILY_TASKS: Omit<DailyTask, 'progress' | 'completed'>[] = [
    { id: 'daily_1', description: '带学徒完成1次副本', target: 1 },
    { id: 'daily_2', description: '为学徒讲解技巧', target: 1 },
    { id: 'daily_3', description: '学徒完成5次战斗', target: 5 },
  ]

  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        relations.value = data.relations || []
        pendingRequests.value = data.pending || []
        dailyTasks.value = data.tasks || []
        lastTaskReset.value = data.lastReset || 0
        checkDailyReset()
      }
    } catch { /* silent */ }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        relations: relations.value,
        pending: pendingRequests.value,
        tasks: dailyTasks.value,
        lastReset: lastTaskReset.value,
      }))
    } catch { /* silent in test env */ }
  }

  // T68 每日重置
  function checkDailyReset() {
    const now = Date.now()
    if (now - lastTaskReset.value >= DAILY_TASK_RESET) {
      dailyTasks.value = DAILY_TASKS.map(t => ({ ...t, progress: 0, completed: false }))
      lastTaskReset.value = now
      save()
    }
  }

  // T68 发起拜师请求
  function requestMentor(apprenticeId: string, apprenticeName: string, mentorId: string): MentorRelation | null {
    // 检查学徒是否已有导师
    if (relations.value.some(r => r.apprenticeId === apprenticeId && r.status === 'active')) return null
    // 检查导师是否已满
    const mentorActiveCount = relations.value.filter(r => r.mentorId === mentorId && r.status === 'active').length
    if (mentorActiveCount >= MAX_MENTOR_COUNT) return null

    const request: MentorRelation = {
      id: generateId(),
      mentorId,
      mentorName: 'mentor_name',
      apprenticeId,
      apprenticeName,
      status: 'active',
      startDate: Date.now(),
      mentorContribution: 0,
      apprenticeProgress: 0,
      rewards: [
        { type: 'mentor', claimed: false, condition: '学徒达到50级', reward: { gold: 10000 } },
        { type: 'mentor', claimed: false, condition: '学徒出师', reward: { gold: 30000, diamond: 100 } },
        { type: 'apprentice', claimed: false, condition: '完成新手任务', reward: { gold: 5000 } },
        { type: 'apprentice', claimed: false, condition: '达到30级', reward: { gold: 10000 } },
        { type: 'apprentice', claimed: false, condition: '出师', reward: { gold: 20000, diamond: 50 } },
      ],
    }
    pendingRequests.value.push(request)
    save()
    return request
  }

  // T68 导师接受学徒
  function acceptApprentice(relationId: string): boolean {
    const idx = pendingRequests.value.findIndex(r => r.id === relationId)
    if (idx < 0) return false
    const relation = pendingRequests.value[idx]
    relation.status = 'active'
    relations.value.push(relation)
    pendingRequests.value.splice(idx, 1)
    save()
    return true
  }

  // T68 拒绝学徒
  function rejectApprentice(relationId: string) {
    pendingRequests.value = pendingRequests.value.filter(r => r.id !== relationId)
    save()
  }

  // T68 增加学徒进度
  function addApprenticeProgress(mentorId: string, apprenticeId: string, progress: number) {
    const relation = relations.value.find(
      r => r.mentorId === mentorId && r.apprenticeId === apprenticeId && r.status === 'active'
    )
    if (!relation) return
    relation.apprenticeProgress = Math.min(COMPLETION_THRESHOLD, relation.apprenticeProgress + progress)
    if (relation.apprenticeProgress >= COMPLETION_THRESHOLD) {
      relation.status = 'completed'
      relation.endDate = Date.now()
    }
    save()
  }

  // T68 增加导师贡献
  function addMentorContribution(mentorId: string, apprenticeId: string, contribution: number) {
    const relation = relations.value.find(
      r => r.mentorId === mentorId && r.apprenticeId === apprenticeId && r.status === 'active'
    )
    if (!relation) return
    relation.mentorContribution += contribution
    save()
  }

  // T68 更新每日任务进度
  function updateDailyTask(taskId: string, increment: number) {
    const task = dailyTasks.value.find(t => t.id === taskId)
    if (!task || task.completed) return
    task.progress = Math.min(task.target, task.progress + increment)
    if (task.progress >= task.target) task.completed = true
    save()
  }

  // T68 获取我的导师
  const myMentor = computed(() =>
    relations.value.find(r => r.apprenticeId === 'player' && r.status === 'active')
  )

  // T68 获取我的学徒
  const myApprentices = computed(() =>
    relations.value.filter(r => r.mentorId === 'player' && r.status === 'active')
  )

  // T68 获取待处理的拜师请求（给导师看）
  const pendingForMe = computed(() =>
    pendingRequests.value.filter(r => r.mentorId === 'player')
  )

  return {
    relations,
    dailyTasks,
    pendingRequests,
    myMentor,
    myApprentices,
    pendingForMe,
    load,
    requestMentor,
    acceptApprentice,
    rejectApprentice,
    addApprenticeProgress,
    addMentorContribution,
    updateDailyTask,
    checkDailyReset,
  }
})
