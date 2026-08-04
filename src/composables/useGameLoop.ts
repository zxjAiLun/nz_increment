import { ref, onUnmounted } from 'vue'
import { GAME } from '../utils/constants'

/**
 * 战斗主循环 composable。
 *
 * 区分「运行意图 shouldRun」与「临时挂起（页面隐藏）」：
 * - start()：显式启动授权——设置 shouldRun=true，页面可见时请求 RAF；
 * - pause()：显式暂停——清除 shouldRun，取消 RAF；只有再次显式 start() 才能恢复；
 * - stop()：停止——清除 shouldRun，取消 RAF，重置 lastTimestamp；hidden→visible 不得自启；
 * - 页面 hidden：仅临时取消 RAF（suspendFrameLoop），不清除 shouldRun；
 * - 页面重新 visible：仅当 shouldRun 为 true 才恢复 RAF 链。
 *
 * Phase 3.49：异步 visibility / 帧末调度失败不向事件或 RAF callback 外抛，统一通知
 * onLifecycleFault（App 分类为 game loop lifecycle failed）。所有取消/恢复均「先提交内部
 * 安全状态、再最佳努力调用浏览器 API」。首次启动期间的资源安装失败（visibility listener
 * 注册异常 / 首次 request 异常）仍由 App startRuntimeOnce 分类为 runtime startup failed，
 * 不走运行期 lifecycle callback。
 */
export function useGameLoop(
  callback: (deltaTime: number) => void,
  onLifecycleFault?: (error: unknown) => void
) {
  const isRunning = ref(false)
  let shouldRun = false
  let lastTimestamp = 0
  let animationFrameId: number | null = null

  // Phase 3.49：visibility listener 注册所有权与保存的注册异常（首次 start 时转交启动事务）。
  let visibilityListenerRegistered = false
  let visibilityRegistrationError: unknown | null = null

  /** 通知 App 运行期 lifecycle fault；自身防御 callback 意外抛出，不外传。 */
  function notifyLifecycleFault(error: unknown) {
    if (!onLifecycleFault) return
    try {
      onLifecycleFault(error)
    } catch {
      // 不向外抛：让浏览器事件 / RAF callback 保持不外抛
    }
  }

  function tick(timestamp: number) {
    if (!isRunning.value) return

    const deltaTime = lastTimestamp ? timestamp - lastTimestamp : GAME.TICK_RATE
    lastTimestamp = timestamp

    // 累积时间，避免长时间 tab 失活后卡顿
    const clampedDelta = Math.min(deltaTime, 200)

    callback(clampedDelta)

    // Phase 3.41：callback 内可能调用 pause()/stop()/卸载 host（如 App 熔断后停循环）。
    // 必须重新检查运行意图与可见状态后再安排下一帧，避免留下游离的额外 RAF 链。
    // Phase 3.49：当前帧 ownership 已消费先置空；请求下一帧失败进入安全停止并通知 lifecycle
    // fault，不让异常逃出真实 RAF callback。
    animationFrameId = null

    if (!(shouldRun && isRunning.value && !document.hidden)) {
      return
    }

    try {
      animationFrameId = requestAnimationFrame(tick)
    } catch (error) {
      animationFrameId = null
      shouldRun = false
      isRunning.value = false
      lastTimestamp = 0
      notifyLifecycleFault(error)
    }
  }

  /** ownership-first 取消：先释放 RAF ID 再最佳努力调用取消 API。返回第一条取消错误。 */
  function cancelFrameLoop(): unknown | null {
    const frameId = animationFrameId
    animationFrameId = null

    if (frameId === null) {
      return null
    }

    try {
      cancelAnimationFrame(frameId)
      return null
    } catch (error) {
      return error
    }
  }

  /**
   * 请求 RAF 链（仅当页面可见时真正安排；重复调用 no-op）。
   * Phase 3.49：原子提交——先尝试 requestAnimationFrame，成功后才提交 ownership/isRunning。
   * 返回错误值供调用方决定（start 首次调用时由启动事务分类；visible 恢复时进入 lifecycle fault）。
   */
  function resumeFrameLoop(): unknown | null {
    if (isRunning.value) return null
    if (document.hidden) return null

    lastTimestamp = 0
    let frameId: number
    try {
      frameId = requestAnimationFrame(tick)
    } catch (error) {
      return error
    }

    animationFrameId = frameId
    isRunning.value = true
    return null
  }

  /** 临时挂起 RAF（页面隐藏），不清除运行意图。Phase 3.49：先置 isRunning false 再取消。 */
  function suspendFrameLoop(): unknown | null {
    isRunning.value = false
    return cancelFrameLoop()
  }

  /**
   * 显式启动授权：设置运行意图并（页面可见时）启动 RAF。
   * Phase 3.49：首次启动期间 visibility listener 注册异常或首次 request 异常直接抛出，
   * 由 App startRuntimeOnce 分类为 runtime startup failed（不走运行期 lifecycle callback）。
   */
  function start() {
    if (visibilityRegistrationError !== null) {
      throw visibilityRegistrationError
    }

    shouldRun = true
    const resumeError = resumeFrameLoop()
    if (resumeError !== null) {
      shouldRun = false
      throw resumeError
    }
  }

  /** 显式暂停：清除运行意图并取消 RAF；只有再次显式 start() 才能恢复。 */
  function pause() {
    shouldRun = false
    suspendFrameLoop()
  }

  /**
   * Phase 3.48：停止——先释放运行许可与 RAF ID 所有权，再最佳努力调用取消 API。
   * cancelAnimationFrame 抛异常时不向调用方传播，返回原始值（null 表示无清理异常）。
   * Phase 3.49：不调用 lifecycle fault callback。
   */
  function stop(): unknown | null {
    shouldRun = false
    isRunning.value = false
    lastTimestamp = 0
    return cancelFrameLoop()
  }

  // visibilitychange：hidden 只临时挂起；visible 只恢复「此前已显式启动且未暂停/停止」的循环。
  // Phase 3.49：cancel/request 异常不外抛，清除 shouldRun 防止恢复，并通知 App lifecycle fault。
  function onVisibilityChange() {
    if (document.hidden) {
      const suspendError = suspendFrameLoop()
      if (suspendError !== null) {
        shouldRun = false
        lastTimestamp = 0
        notifyLifecycleFault(suspendError)
      }
    } else {
      if (shouldRun) {
        const resumeError = resumeFrameLoop()
        if (resumeError !== null) {
          shouldRun = false
          isRunning.value = false
          lastTimestamp = 0
          notifyLifecycleFault(resumeError)
        }
      }
    }
  }

  // Phase 3.49：注册失败不得使 Vue setup/mount 抛出；保存原始异常，首次 start 时转交。
  try {
    document.addEventListener('visibilitychange', onVisibilityChange)
    visibilityListenerRegistered = true
  } catch (error) {
    visibilityRegistrationError = error
  }

  onUnmounted(() => {
    // Phase 3.48：stop 已内部收敛异常；Phase 3.49 不调用 lifecycle fault callback。
    stop()

    // Phase 3.49：仅已成功注册才移除；ownership flag 先清除再最佳努力调用。
    if (visibilityListenerRegistered) {
      visibilityListenerRegistered = false
      try {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      } catch {
        // ownership 已失效，卸载不得向外抛
      }
    }
  })

  return { isRunning, start, pause, stop }
}
