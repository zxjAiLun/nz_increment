/**
 * 唯一「正向时间戳」解析（被 playerStore 离线结算与 offlineReward 规范化共用）。
 *
 * 关键陷阱：`Number(localStorage.getItem(...))` 在 key 缺失时返回 0、且 `Number.isFinite(0)`
 * 为真，若直接拿它当时间戳判断，缺失的辅助 key 会被误当 Unix epoch，算出 ~56 年离线时长并
 * 截断为满 24h 收益。故本函数对一切「非正有限值」一律返回 null：
 *   null / undefined / '' / 空白 / 'null' / 'NaN' / 'Infinity' / 0 / 负数 / NaN / Infinity
 * 调用方据此回退到下一优先级来源或当前时间，绝不会把无效值当有效时间戳。
 */
export function parsePositiveTimestamp(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}
