import { ref, onUnmounted } from 'vue'
import { GAME } from '../utils/constants'

/**
 * 战斗主循环 composable（Phase 3.40 Repair 1）。
 *
 * 区分「运行意图 shouldRun」与「临时挂起（页面隐藏）」：
 * - start()：显式启动授权——设置 shouldRun=true，页面可见时请求 RAF；
 * - pause()：显式暂停——清除 shouldRun，取消 RAF；只有再次显式 start() 才能恢复；
 * - stop()：停止——清除 shouldRun，取消 RAF，重置 lastTimestamp；hidden→visible 不得自启；
 * - 页面 hidden：仅临时取消 RAF（suspendFrameLoop），不清除 shouldRun；
 * - 页面重新 visible：仅当 shouldRun 为 true 才恢复 RAF 链。
 *
 * 因此「从未显式 start()」（如 Phase 3.40 blocked 状态）或已 pause()/stop() 时，
 * hidden→visible 不会自行启动游戏循环，杜绝 visibilitychange 绕过 App 运行时闸门。
 */
export function useGameLoop(callback: (deltaTime: number) => void) {
  const isRunning = ref(false)
  let shouldRun = false
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

  function cancelFrameLoop() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  /** 请求 RAF 链（仅当页面可见时真正安排；重复调用 no-op）。 */
  function resumeFrameLoop() {
    if (isRunning.value) return
    if (document.hidden) return
    isRunning.value = true
    lastTimestamp = 0
    animationFrameId = requestAnimationFrame(tick)
  }

  /** 临时挂起 RAF（页面隐藏），不清除运行意图。 */
  function suspendFrameLoop() {
    cancelFrameLoop()
    isRunning.value = false
  }

  /** 显式启动授权：设置运行意图并（页面可见时）启动 RAF。 */
  function start() {
    shouldRun = true
    resumeFrameLoop()
  }

  /** 显式暂停：清除运行意图并取消 RAF；只有再次显式 start() 才能恢复。 */
  function pause() {
    shouldRun = false
    suspendFrameLoop()
  }

  /** 停止：清除运行意图、取消 RAF、重置时间戳；hidden→visible 不得自行重启。 */
  function stop() {
    shouldRun = false
    suspendFrameLoop()
    lastTimestamp = 0
  }

  // visibilitychange：hidden 只临时挂起；visible 只恢复「此前已显式启动且未暂停/停止」的循环。
  function onVisibilityChange() {
    if (document.hidden) {
      suspendFrameLoop()
    } else {
      if (shouldRun) {
        resumeFrameLoop()
      }
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  onUnmounted(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { isRunning, start, pause, stop }
}
