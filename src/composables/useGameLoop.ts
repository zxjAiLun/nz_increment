import { ref, onUnmounted } from 'vue'
import { GAME } from '../utils/constants'

export function useGameLoop(callback: (deltaTime: number) => void) {
  const isRunning = ref(false)
  let lastTimestamp = 0
  let animationFrameId: number | null = null

  function tick(timestamp: number) {
    if (!isRunning.value) return

    const deltaTime = lastTimestamp ? timestamp - lastTimestamp : GAME.TICK_RATE
    lastTimestamp = timestamp

    // 累积时间，避免长时间 tab 失活后卡顿
    const clampedDelta = Math.min(deltaTime, 200)

    callback(clampedDelta)

    animationFrameId = requestAnimationFrame(tick)
  }

  function start() {
    if (isRunning.value) return
    isRunning.value = true
    lastTimestamp = 0
    animationFrameId = requestAnimationFrame(tick)
  }

  function pause() {
    isRunning.value = false
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  function stop() {
    pause()
    lastTimestamp = 0
  }

  // visibilitychange 时暂停省电
  function onVisibilityChange() {
    if (document.hidden) pause()
    else start()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  onUnmounted(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { isRunning, start, pause, stop }
}
