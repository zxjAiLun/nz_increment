// 纯 storage 补偿原语：不依赖 Pinia，不依赖任何 Store，不承载任何业务语义。
// 仅负责「按逆序把一组 key 还原到写入前的 raw 值」——即补偿事务在持久化失败时的 reverse raw restoration。
// 调用方负责：内存快照/候选/持久化顺序/错误分类；本文件只做 storage 层逆序还原。

export type StorageRaw = readonly [key: string, previous: string | null]

// raws 以「写入顺序」提供；补偿时按逆序还原（最后写入的先回滚）。
// previous === null 表示写入前该 key 不存在 → 还原为 removeItem；否则 setItem(previous)。
// 任一步存储失败不中断后续补偿（尽力全部还原），最后统一抛 fixedError；全部成功则正常返回。
export function compensateStorageRaws(raws: readonly StorageRaw[], fixedError: string): void {
  let failed = false
  for (let i = raws.length - 1; i >= 0; i--) {
    const [k, p] = raws[i]
    try {
      if (p === null) localStorage.removeItem(k)
      else localStorage.setItem(k, p)
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error(fixedError)
}
