import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BattleReplay, BattleReplayEvent } from '../data/battleReplay'

export const useReplayStore = defineStore('replay', () => {
  const replays = ref<BattleReplay[]>([])
  const currentReplay = ref<BattleReplay | null>(null)
  const playbackIndex = ref(0)
  const isPlaying = ref(false)

  function saveReplay(replay: Omit<BattleReplay, 'id'>) {
    const id = `replay_${Date.now()}`
    replays.value.unshift({ ...replay, id })
    // Keep last 20 replays
    if (replays.value.length > 20) replays.value.pop()
  }

  function loadReplay(replayId: string) {
    const replay = replays.value.find(r => r.id === replayId)
    if (!replay) return
    currentReplay.value = replay
    playbackIndex.value = 0
    isPlaying.value = false
  }

  function playNextEvent(): BattleReplayEvent | null {
    if (!currentReplay.value) return null
    if (playbackIndex.value >= currentReplay.value.events.length) {
      isPlaying.value = false
      return null
    }
    const event = currentReplay.value.events[playbackIndex.value]
    playbackIndex.value++
    return event
  }

  function startPlayback() {
    isPlaying.value = true
    playbackIndex.value = 0
  }

  function pausePlayback() {
    isPlaying.value = false
  }

  function getCurrentEvent(): BattleReplayEvent | null {
    if (!currentReplay.value) return null
    return currentReplay.value.events[playbackIndex.value] || null
  }

  // T91 获取回放统计
  function getReplayStats(replayId: string) {
    const replay = replays.value.find(r => r.id === replayId)
    if (!replay) return null
    
    let totalDamage = 0
    let maxHit = 0
    let critCount = 0
    let healCount = 0
    
    for (const event of replay.events) {
      if (event.type === 'damage') {
        totalDamage += event.value
        if (event.isCrit) critCount++
        maxHit = Math.max(maxHit, event.value)
      } else if (event.type === 'heal') {
        healCount++
      }
    }
    
    return {
      totalDamage,
      maxHit,
      critCount,
      healCount,
      duration: replay.events.length,
    }
  }

  // T91 导出回放为JSON
  function exportReplay(replayId: string): string | null {
    const replay = replays.value.find(r => r.id === replayId)
    if (!replay) return null
    return JSON.stringify(replay, null, 2)
  }

  // T91 从JSON导入回放
  function importReplay(json: string): boolean {
    try {
      const data = JSON.parse(json) as BattleReplay
      if (!data.id || !data.events || !Array.isArray(data.events)) {
        return false
      }
      data.id = `replay_${Date.now()}_imported`
      replays.value.unshift(data)
      if (replays.value.length > 20) replays.value.pop()
      return true
    } catch {
      return false
    }
  }

  // T91 删除回放
  function deleteReplay(replayId: string) {
    replays.value = replays.value.filter(r => r.id !== replayId)
    if (currentReplay.value?.id === replayId) {
      currentReplay.value = null
    }
  }

  // T91 分享回放（生成分享码）
  function shareReplay(replayId: string): string | null {
    const replay = replays.value.find(r => r.id === replayId)
    if (!replay) return null
    const shareCode = btoa(JSON.stringify({ id: replay.id, name: replay.playerName })).substring(0, 12)
    return shareCode
  }

  return { 
    replays, 
    currentReplay, 
    playbackIndex, 
    isPlaying, 
    saveReplay, 
    loadReplay, 
    playNextEvent, 
    startPlayback, 
    pausePlayback, 
    getCurrentEvent,
    getReplayStats,
    exportReplay,
    importReplay,
    deleteReplay,
    shareReplay,
  }
})
