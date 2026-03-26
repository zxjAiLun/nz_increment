const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

export function formatNumber(num: number, decimals: number = 1): string {
  if (num < 1000) return Math.floor(num).toString()
  
  const tier = Math.floor(Math.log10(Math.abs(num)) / 3)
  if (tier === 0) return num.toString()
  
  const suffix = SUFFIXES[tier] || `e${tier * 3}`
  const scale = Math.pow(10, tier * 3)
  const scaled = num / scale
  
  return scaled.toFixed(decimals).replace(/\.0$/, '') + suffix
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}小时${m}分钟`
  }
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return `${d}天${h}小时`
}

export function formatDuration(ms: number): string {
  return formatTime(ms / 1000)
}
