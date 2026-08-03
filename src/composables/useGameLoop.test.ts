// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useGameLoop } from './useGameLoop'

/**
 * Phase 3.40 Repair 1 — useGameLoop 生命周期状态机。
 *
 * 核心：区分「运行意图 shouldRun」与「临时挂起（页面隐藏）」。
 * - 从未显式 start()：hidden→visible 不得启动 RAF；
 * - 显式 start() 后 hidden：仅临时挂起，visible 恢复一条 RAF 链；
 * - pause()/stop() 后：hidden→visible 不得恢复，只有再次显式 start() 才恢复；
 * - 重复 start()：不重复安排第二条 RAF 链。
 *
 * 通过 host 组件挂载 composable，让 onUnmounted 在用例结束后移除
 * visibilitychange listener，避免跨用例累积污染。
 */

type LoopApi = ReturnType<typeof useGameLoop>
let currentLoop: LoopApi | null = null

/** 包装组件：setup 中创建 useGameLoop，卸载时触发 onUnmounted 清理 listener。 */
const LoopHost = defineComponent({
  props: {
    callback: { type: Function, required: true }
  },
  setup(props) {
    currentLoop = useGameLoop(props.callback as (d: number) => void)
    return () => h('div', { class: 'loop-host' })
  }
})

let wrapper: VueWrapper | null = null
let rafSpy: ReturnType<typeof vi.spyOn>
let cafSpy: ReturnType<typeof vi.spyOn>
let rafCallback: ((ts: number) => void) | null = null

/** 模拟页面可见/隐藏并派发 visibilitychange。 */
function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

function mountHost(cb: (d: number) => void) {
  currentLoop = null
  wrapper = mount(LoopHost, { props: { callback: cb } })
  return currentLoop!
}

function unmountHost() {
  wrapper?.unmount()
  wrapper = null
  currentLoop = null
}

/** 手动执行一次 RAF 回调（模拟浏览器帧）。 */
function runFrame(ts = 16) {
  const cb = rafCallback
  rafCallback = null
  if (cb) cb(ts)
}

beforeEach(() => {
  rafCallback = null
  rafSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation(cb => {
      rafCallback = cb
      return 1
    })
  cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    rafCallback = null
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false
  })
})

afterEach(() => {
  unmountHost()
  vi.restoreAllMocks()
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false
  })
})

describe('Phase 3.40 Repair 1 — useGameLoop 运行意图状态机', () => {
  it('从未显式启动：hidden → visible 后 callback 与 RAF 均零调用、isRunning false', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    setPageHidden(true)
    expect(rafSpy).not.toHaveBeenCalled()

    setPageHidden(false)
    expect(rafSpy).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()
    expect(loop.isRunning.value).toBe(false)
  })

  it('显式启动后隐藏：hidden 取消 RAF、不执行后台 callback', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    expect(rafSpy).toHaveBeenCalledTimes(1)
    runFrame(16)
    expect(cb).toHaveBeenCalledTimes(1)

    setPageHidden(true)
    expect(cafSpy).toHaveBeenCalled()
    rafCallback = null
    expect(cb).toHaveBeenCalledTimes(1) // 隐藏后不再执行
    expect(loop.isRunning.value).toBe(false)
  })

  it('显式启动后重新可见：恢复一条 RAF 链、不重复启动多个循环', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    expect(rafSpy).toHaveBeenCalledTimes(1)

    setPageHidden(true) // 挂起：取消 RAF
    const callsAfterHidden = rafSpy.mock.calls.length
    setPageHidden(false) // 恢复：只请求一条新 RAF
    expect(rafSpy.mock.calls.length).toBe(callsAfterHidden + 1)
    expect(loop.isRunning.value).toBe(true)

    // 再次 visible（已在运行）不得再安排
    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterHidden + 2) // 每次恢复恰 +1
  })

  it('显式 pause 后：hidden → visible 不得恢复，再次显式 start() 才恢复', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    loop.pause()
    const callsAfterPause = rafSpy.mock.calls.length

    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterPause) // 不恢复
    expect(loop.isRunning.value).toBe(false)

    // 再次显式 start 才恢复
    loop.start()
    expect(rafSpy.mock.calls.length).toBe(callsAfterPause + 1)
  })

  it('stop 后：hidden → visible 不得恢复、lastTimestamp 保持重置语义', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    runFrame(16)
    loop.stop()
    const callsAfterStop = rafSpy.mock.calls.length

    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterStop) // 不恢复
    expect(loop.isRunning.value).toBe(false)

    // stop 后再次 start 应重置 lastTimestamp（首个 delta 用 TICK_RATE）
    loop.start()
    runFrame(16)
    expect(cb).toHaveBeenLastCalledWith(16) // GAME.TICK_RATE
  })

  it('重复 start：不重复请求第二条 RAF 链', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    loop.start()
    loop.start()
    expect(rafSpy).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 3.41 — 帧内停止与故障后不恢复', () => {
  it('callback 内调用 stop() 后不安排下一帧', () => {
    const cb = vi.fn(() => {
      const loop = currentLoop!
      loop.stop()
    })
    const loop = mountHost(cb)

    loop.start()
    runFrame(16)
    // stop 清除了运行意图：tick 重检后不应再安排下一帧
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(rafCallback).toBeNull()
    expect(loop.isRunning.value).toBe(false)
  })

  it('callback 内调用 pause() 后不安排下一帧', () => {
    const cb = vi.fn(() => {
      const loop = currentLoop!
      loop.pause()
    })
    const loop = mountHost(cb)

    loop.start()
    runFrame(16)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(rafCallback).toBeNull()
    expect(loop.isRunning.value).toBe(false)
  })

  it('callback 内卸载 host 后不安排下一帧', () => {
    const cb = vi.fn(() => {
      unmountHost()
    })
    const loop = mountHost(cb)

    loop.start()
    runFrame(16)
    // 组件卸载触发 onUnmounted → stop()：shouldRun=false，不再安排下一帧
    expect(rafCallback).toBeNull()
  })

  it('正常 callback 仍只安排一条后续 RAF', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    expect(rafSpy).toHaveBeenCalledTimes(1)
    runFrame(16)
    // 正常运行：tick 重检通过，安排下一条
    expect(rafSpy).toHaveBeenCalledTimes(2)
    expect(rafCallback).not.toBeNull()
  })

  it('故障停止后 hidden → visible 不恢复', () => {
    const cb = vi.fn()
    const loop = mountHost(cb)

    loop.start()
    runFrame(16)
    loop.stop() // 模拟故障熔断 stop
    const callsAfterStop = rafSpy.mock.calls.length

    setPageHidden(true)
    setPageHidden(false)
    expect(rafSpy.mock.calls.length).toBe(callsAfterStop) // 不恢复
    expect(loop.isRunning.value).toBe(false)
  })
})
