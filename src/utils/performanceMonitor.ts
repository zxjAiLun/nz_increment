// T99 性能监控工具

export interface PerformanceMetric {
  name: string
  startTime: number
  endTime?: number
  duration?: number
  metadata?: Record<string, unknown>
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private enabled: boolean = true

  // T99 开启/关闭监控
  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  // T99 开始计时
  startTimer(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return
    this.metrics.push({
      name,
      startTime: performance.now(),
      metadata,
    })
  }

  // T99 结束计时并记录
  endTimer(name: string): number | null {
    if (!this.enabled) return null
    
    const metric = this.metrics.find(m => m.name === name && !m.endTime)
    if (!metric) return null
    
    metric.endTime = performance.now()
    metric.duration = metric.endTime - metric.startTime
    return metric.duration
  }

  // T99 获取所有指标
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics]
  }

  // T99 获取特定指标
  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.find(m => m.name === name)
  }

  // T99 获取平均执行时间
  getAverageDuration(name: string): number {
    const relevant = this.metrics.filter(m => m.name === name && m.duration !== undefined)
    if (relevant.length === 0) return 0
    const total = relevant.reduce((sum, m) => sum + (m.duration || 0), 0)
    return total / relevant.length
  }

  // T99 清除所有指标
  clear(): void {
    this.metrics = []
  }

  // T99 获取报告
  getReport(): string {
    const lines: string[] = ['=== Performance Report ===']
    const grouped = new Map<string, PerformanceMetric[]>()
    
    for (const m of this.metrics) {
      if (m.duration !== undefined) {
        const existing = grouped.get(m.name) || []
        existing.push(m)
        grouped.set(m.name, existing)
      }
    }
    
    for (const [name, metrics] of grouped) {
      const durations = metrics.map(m => m.duration!)
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      const min = Math.min(...durations)
      const max = Math.max(...durations)
      lines.push(`${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms, count=${durations.length}`)
    }
    
    return lines.join('\n')
  }
}

// 全局单例
export const perfMonitor = new PerformanceMonitor()

// T99 FPS监控
export class FPSMonitor {
  private frames: number[] = []
  private lastTime: number = 0
  private sampleSize: number = 60

  update(): void {
    const now = performance.now()
    if (this.lastTime > 0) {
      const delta = now - this.lastTime
      this.frames.push(1000 / delta)
      if (this.frames.length > this.sampleSize) {
        this.frames.shift()
      }
    }
    this.lastTime = now
  }

  getFPS(): number {
    if (this.frames.length === 0) return 0
    return Math.round(this.frames.reduce((a, b) => a + b, 0) / this.frames.length)
  }

  getMinFPS(): number {
    if (this.frames.length === 0) return 0
    return Math.round(Math.min(...this.frames))
  }

  getMaxFPS(): number {
    if (this.frames.length === 0) return 0
    return Math.round(Math.max(...this.frames))
  }
}

// T99 内存监控
export function getMemoryUsage(): { used: number; total: number; percentage: number } | null {
  if ('memory' in performance && (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory) {
    const memory = (performance as { memory: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
    return {
      used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
      percentage: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100),
    }
  }
  return null
}
