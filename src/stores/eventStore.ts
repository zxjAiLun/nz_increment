import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { RANDOM_EVENTS, type RandomEvent } from '../data/randomEvents'
import { usePlayerStore } from './playerStore'

// T83 活动事件类型
export type EventCategory = 'daily' | 'weekly' | 'seasonal' | 'limited' | 'holiday'

// T83 定时活动定义
export interface ScheduledEvent {
  id: string
  name: string
  description: string
  category: EventCategory
  startTime: number
  endTime: number
  rewards: { type: string; value: number }[]
  milestones: { points: number; rewards: string }[]
}

// T83 玩家活动进度
export interface EventProgress {
  eventId: string
  currentPoints: number
  claimedMilestones: number[]
}

export const useEventStore = defineStore('event', () => {
  const playerStore = usePlayerStore()
  const currentEvent = ref<RandomEvent | null>(null)
  const eventHistory = ref<RandomEvent[]>([])
  const activeBuffs = ref<{ [key: string]: number }>({})
  
  // T83 定时活动
  const scheduledEvents = ref<ScheduledEvent[]>([
    {
      id: 'double_gold_weekend',
      name: '双倍金币周末',
      description: '周末期间所有金币获取翻倍！',
      category: 'weekly',
      startTime: Date.now(),
      endTime: Date.now() + 2 * 24 * 60 * 60 * 1000,
      rewards: [{ type: 'gold', value: 2 }],
      milestones: [
        { points: 100, rewards: 'common_chest' },
        { points: 500, rewards: 'rare_chest' },
        { points: 1000, rewards: 'epic_chest' },
      ],
    },
    {
      id: 'diamond_rush',
      name: '钻石冲刺',
      description: '活动期间登录即送钻石！',
      category: 'limited',
      startTime: Date.now(),
      endTime: Date.now() + 3 * 24 * 60 * 60 * 1000,
      rewards: [{ type: 'diamond', value: 100 }],
      milestones: [
        { points: 1, rewards: 'diamond_50' },
        { points: 3, rewards: 'diamond_100' },
        { points: 7, rewards: 'diamond_500' },
      ],
    },
  ])
  
  // T83 玩家活动进度
  const eventProgress = ref<EventProgress[]>([])
  
  // T83 活动积分（临时）
  const currentPoints = ref(0)

  function rollEvent(): RandomEvent {
    const total = RANDOM_EVENTS.reduce((sum, e) => sum + e.probability, 0)
    let rand = Math.random() * total
    for (const event of RANDOM_EVENTS) {
      rand -= event.probability
      if (rand <= 0) {
        currentEvent.value = event
        eventHistory.value.unshift(event)
        if (eventHistory.value.length > 10) eventHistory.value.pop()
        return event
      }
    }
    return RANDOM_EVENTS[0]
  }

  function applyEvent(event: RandomEvent) {
    if (event.effect.gold) playerStore.addGold(event.effect.gold)
    if (event.effect.diamond) playerStore.addDiamond(event.effect.diamond)
    if (event.effect.hp) playerStore.player.currentHp = Math.min(playerStore.player.maxHp, playerStore.player.currentHp + event.effect.hp)
    if (event.effect.buff) activeBuffs.value[event.effect.buff] = 3
    if (event.effect.debuff) activeBuffs.value[event.effect.debuff] = 3
    currentEvent.value = null
  }

  function clearEvent() {
    currentEvent.value = null
  }

  function tickBuffs() {
    for (const buff in activeBuffs.value) {
      activeBuffs.value[buff]--
      if (activeBuffs.value[buff] <= 0) delete activeBuffs.value[buff]
    }
  }
  
  // T83 获取当前有效的活动
  const activeScheduledEvents = computed(() => {
    const now = Date.now()
    return scheduledEvents.value.filter(e => now >= e.startTime && now <= e.endTime)
  })
  
  // T83 是否有双倍金币活动
  const hasDoubleGold = computed(() => {
    return activeScheduledEvents.value.some(e => e.id === 'double_gold_weekend')
  })
  
  // T83 是否有双倍经验活动
  const hasDoubleExp = computed(() => {
    return activeScheduledEvents.value.some(e => e.id === 'double_exp_event')
  })
  
  // T83 获取活动进度
  function getEventProgress(eventId: string): EventProgress | undefined {
    return eventProgress.value.find(p => p.eventId === eventId)
  }
  
  // T83 增加活动积分
  function addEventPoints(eventId: string, points: number) {
    let progress = eventProgress.value.find(p => p.eventId === eventId)
    if (!progress) {
      progress = { eventId, currentPoints: 0, claimedMilestones: [] }
      eventProgress.value.push(progress)
    }
    progress.currentPoints += points
    currentPoints.value = progress.currentPoints
  }
  
  // T83 领取里程碑奖励
  function claimMilestone(eventId: string, milestoneIndex: number): string | null {
    const event = scheduledEvents.value.find(e => e.id === eventId)
    if (!event) return null
    
    const progress = eventProgress.value.find(p => p.eventId === eventId)
    if (!progress) return null
    
    const milestone = event.milestones[milestoneIndex]
    if (!milestone) return null
    if (progress.currentPoints < milestone.points) return null
    if (progress.claimedMilestones.includes(milestoneIndex)) return null
    
    progress.claimedMilestones.push(milestoneIndex)
    return milestone.rewards
  }
  
  // T83 获取下一个可领取的里程碑
  function getNextMilestone(eventId: string): number | null {
    const event = scheduledEvents.value.find(e => e.id === eventId)
    const progress = eventProgress.value.find(p => p.eventId === eventId)
    const currentPoints = progress?.currentPoints || 0
    
    for (let i = 0; i < event?.milestones.length; i++) {
      if (progress?.claimedMilestones.includes(i)) continue
      if (currentPoints >= event.milestones[i].points) return i
    }
    return null
  }

  return { 
    currentEvent, 
    eventHistory, 
    activeBuffs, 
    scheduledEvents,
    eventProgress,
    currentPoints,
    activeScheduledEvents,
    hasDoubleGold,
    hasDoubleExp,
    rollEvent, 
    applyEvent, 
    clearEvent, 
    tickBuffs,
    getEventProgress,
    addEventPoints,
    claimMilestone,
    getNextMilestone,
  }
})
