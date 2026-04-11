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

  return { replays, currentReplay, playbackIndex, isPlaying, saveReplay, loadReplay, playNextEvent, startPlayback, pausePlayback, getCurrentEvent }
})
