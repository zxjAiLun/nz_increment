import { ref } from 'vue'

// 共享的游戏状态
export const battleMode = ref<'main' | 'training'>('main')
export const isPaused = ref(false)

export function useGameState() {
  return {
    battleMode,
    isPaused
  }
}

export function setBattleMode(mode: 'main' | 'training') {
  battleMode.value = mode
}

export function togglePause() {
  isPaused.value = !isPaused.value
}
