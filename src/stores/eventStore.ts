import { defineStore } from 'pinia'
import { ref } from 'vue'
import { RANDOM_EVENTS, type RandomEvent } from '../data/randomEvents'
import { usePlayerStore } from './playerStore'

export const useEventStore = defineStore('event', () => {
  const playerStore = usePlayerStore()
  const currentEvent = ref<RandomEvent | null>(null)
  const eventHistory = ref<RandomEvent[]>([])
  const activeBuffs = ref<{ [key: string]: number }>({})  // buffId -> remaining turns

  function rollEvent(): RandomEvent {
    // 按概率加权随机
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
    if (event.effect.buff) activeBuffs.value[event.effect.buff] = 3  // 持续3回合
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

  return { currentEvent, eventHistory, activeBuffs, rollEvent, applyEvent, clearEvent, tickBuffs }
})
