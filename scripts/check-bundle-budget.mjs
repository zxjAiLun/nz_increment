/**
 * Phase 3.32 — Bundle Budget 检查脚本（锁定 Phase 3.31 拆包成果为 CI 硬门）。
 *
 * 读取 vite build 产物 dist/：
 *   1. 从 dist/index.html 定位 type="module" 入口 <script src>（缺失 / 多个候选 /
 *      路径逃逸 / 文件不存在 → fail-closed）；
 *   2. 按十进制字节检查预算（与 Vite 输出口径一致）：
 *        - 入口 JS raw      ≤ entryRaw     （默认 400000）
 *        - 入口 JS gzip     ≤ entryGzip    （默认 140000，node:zlib 计算，不新增依赖）
 *        - 任意非入口 JS    ≤ maxAsyncChunk（默认 200000）
 *        - 非入口 JS chunk 数量 ≥ minAsyncChunks（默认 15）
 *
 * 纯逻辑导出 inspectBundle(distDir, budgets) → 结构化报告；仅脚本作为 CLI 直接
 * 运行时才打印报告 / 失败明细并设置 process.exitCode = 1。不修改 dist；
 * 不吞掉文件系统或 HTML 解析错误；不使用 Vite 日志文本或 ANSI grep。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const DEFAULT_BUDGETS = {
  entryRaw: 400000,
  entryGzip: 140000,
  maxAsyncChunk: 200000,
  minAsyncChunks: 15
}

/** 解码后仍可能改变路径结构的危险百分号编码（fail-closed 兜底）。 */
const DANGEROUS_ENCODED = /%(?:00|2e|2f|5c|3a)/i

/**
 * 对路径执行完整安全检查（fail-closed）：NUL、外部 URL、协议相对 URL、独立 .. 段。
 * 原始字符串与解码后的 pathname 都必须各自通过本轮检查。
 */
function assertSafePathname(pathname, raw) {
  if (pathname.includes('\0')) {
    throw new Error(`Bundle budget: 入口路径含 NUL: ${raw}`)
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pathname)) {
    throw new Error(`Bundle budget: 外部 URL 入口: ${raw}`)
  }
  if (/^\/\//.test(pathname)) {
    throw new Error(`Bundle budget: 协议相对 URL 入口: ${raw}`)
  }
  if (pathname.split(/[\\/]/).includes('..')) {
    throw new Error(`Bundle budget: 入口路径逃逸 dist: ${raw}`)
  }
}

/**
 * 两阶段规范化 + 安全校验（fail-closed）：
 *   1. 从原始 src 去除 query/hash；
 *   2. 对原始字符串执行基础安全检查（NUL / 外部 scheme / 协议相对 / 独立 ..）；
 *   3. 用 decodeURIComponent 解码一次（抛错 → fail-closed）；
 *   4. 对解码后的 pathname 重新执行完整安全检查——百分号编码的外部 URL（https%3A…
 *      ）与协议相对 URL（%2F%2F…）在解码后必然命中外部 scheme / // 检查；
 *   5. 重复解码直到稳定，每一轮都做完整安全检查，覆盖任意深度的嵌套编码
 *      （%252e%252e、%2500 等）；无法稳定或最终仍含危险百分号编码 → fail-closed。
 *
 * 返回安全、已解码、已去 query/hash 的 pathname；任何不安全输入直接抛错。
 */
function decodeAndValidateEntryPath(src) {
  const raw = String(src)
  if (raw.includes('\0')) {
    throw new Error(`Bundle budget: 入口路径含 NUL: ${raw}`)
  }
  // 去除 query/hash
  const pathnameRaw = raw.split(/[?#]/, 1)[0]
  assertSafePathname(pathnameRaw, raw)

  let pathname = pathnameRaw
  // decodeURIComponent 每次成功改变结果都会消耗至少一个百分号编码；以输入长度
  // 为上界即可覆盖任意有限深度的嵌套编码，同时保留 fail-closed 的循环保护。
  const maxDecodeRounds = pathnameRaw.length + 1
  let stabilized = false
  for (let round = 0; round < maxDecodeRounds; round++) {
    let decoded
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      throw new Error(`Bundle budget: 入口路径无法安全解码: ${raw}`)
    }
    if (decoded === pathname) {
      stabilized = true
      break // 已稳定，无剩余可解码内容
    }
    pathname = decoded
    assertSafePathname(pathname, raw)
  }
  if (!stabilized) {
    throw new Error(`Bundle budget: 入口路径无法稳定解码: ${raw}`)
  }
  assertSafePathname(pathname, raw)
  if (DANGEROUS_ENCODED.test(pathname)) {
    throw new Error(`Bundle budget: 入口路径含未解码的危险结构: ${raw}`)
  }
  return pathname
}

/**
 * 将 index.html 中的入口 script src 安全映射到 dist 内的实际 JS 文件。
 * 支持 Vite 根路径（assets/x.js、/assets/x.js）与非根 base（/game/assets/x.js、
 * /apps/game/assets/x.js 等）以及 query/hash；不依赖固定 base 名或固定 hash。
 *
 * 入口先用 decodeAndValidateEntryPath 完成两阶段规范化 + 安全校验（fail-closed）：
 *   - 拒绝外部 URL（http: https: 等）、协议相对 URL（//host/...）、NUL；
 *   - 拒绝原始或 URL 编码后的 .. 路径段（如 %2e%2e）、双重编码路径以及无法安全
 *     解码的路径；百分号编码的外部 scheme / // 在解码后同样被拒绝；
 *   - 先与 dist 内全部 JS 的相对路径（规范化 / 分隔）精确匹配；
 *   - 无精确匹配时允许 pathname 以 /${rel} 结尾（剥离 Vite base 前缀）；
 *   - suffix 匹配必须恰好得到一个候选：0 个 → 入口文件不存在；多个 → 路径歧义；
 *   - 最终候选必须位于 dist 内且是普通文件。
 */
function resolveEntryPath(distBase, src, jsFiles) {
  const raw = String(src)
  const pathname = decodeAndValidateEntryPath(raw)

  // dist 内全部 JS 的相对路径（规范化 / 分隔）
  const relPaths = jsFiles.map(p => relative(distBase, p).split(sep).join('/'))

  // 1) 精确匹配：pathname === rel 或 pathname === /rel
  let matches = relPaths.filter(rel => pathname === rel || pathname === `/${rel}`)

  // 2) suffix 匹配（剥离 Vite base 前缀）：pathname 以 /${rel} 结尾
  if (matches.length === 0) {
    matches = relPaths.filter(rel => pathname.endsWith(`/${rel}`))
  }

  if (matches.length === 0) {
    throw new Error(`Bundle budget: 入口文件不存在: ${raw}`)
  }
  if (matches.length > 1) {
    throw new Error(`Bundle budget: 入口路径歧义（多个候选）: ${raw} → ${matches.join(', ')}`)
  }

  const entry = join(distBase, ...matches[0].split('/'))
  const rel = relative(distBase, entry)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`Bundle budget: 入口路径逃逸 dist: ${raw}`)
  }
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new Error(`Bundle budget: 入口文件不存在: ${entry}`)
  }
  return entry
}

/** 递归收集 dist（从 resolve 后的绝对根开始，保证相对/绝对调用口径一致）下全部 .js 文件绝对路径。 */
function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectJsFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * 检查 bundle 预算。返回结构化报告（不抛错，失败信息在 report.failures）：
 *   { ok, entry, entryRaw, entryRawLimit, entryGzip, entryGzipLimit,
 *     asyncChunkCount, minAsyncChunks, largestAsyncRaw, maxAsyncChunkLimit,
 *     failures: string[] }
 * 入口定位类错误（缺 module script / 多入口 / 路径逃逸 / 文件不存在）直接抛错。
 */
export function inspectBundle(distDir, budgets = DEFAULT_BUDGETS) {
  const distBase = resolve(distDir)
  const indexPath = join(distBase, 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(`Bundle budget: dist/index.html 不存在: ${indexPath}`)
  }
  const html = readFileSync(indexPath, 'utf8')

  const moduleSrcs = []
  const scriptRe = /<script\b[^>]*>/gi
  let match
  while ((match = scriptRe.exec(html)) !== null) {
    const tag = match[0]
    if (/type\s*=\s*["']module["']/i.test(tag)) {
      const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
      if (srcMatch) moduleSrcs.push(srcMatch[1])
    }
  }

  if (moduleSrcs.length === 0) {
    throw new Error('Bundle budget: dist/index.html 中未找到 type="module" 入口 script')
  }
  if (moduleSrcs.length > 1) {
    throw new Error(`Bundle budget: dist/index.html 中发现多个入口 module script: ${moduleSrcs.join(', ')}`)
  }

  // 从绝对根收集，保证相对/绝对 distDir 调用下入口与 async chunk 比较口径一致
  const jsFiles = collectJsFiles(distBase)
  const entry = resolveEntryPath(distBase, moduleSrcs[0], jsFiles)

  const entryRaw = statSync(entry).size
  const entryGzip = gzipSync(readFileSync(entry)).length

  const asyncChunks = jsFiles.filter(p => p !== entry)
  const largestAsyncRaw = asyncChunks.length
    ? Math.max(...asyncChunks.map(p => statSync(p).size))
    : 0
  const largestAsyncFile = asyncChunks.length
    ? asyncChunks.find(p => statSync(p).size === largestAsyncRaw)
    : null

  const failures = []
  if (entryRaw > budgets.entryRaw) {
    failures.push(`Entry raw ${entryRaw} > limit ${budgets.entryRaw} bytes (${relative(distBase, entry)})`)
  }
  if (entryGzip > budgets.entryGzip) {
    failures.push(`Entry gzip ${entryGzip} > limit ${budgets.entryGzip} bytes`)
  }
  if (largestAsyncRaw > budgets.maxAsyncChunk) {
    failures.push(`Async chunk ${largestAsyncRaw} > limit ${budgets.maxAsyncChunk} bytes (${largestAsyncFile ? relative(distBase, largestAsyncFile).split(sep).join('/') : 'unknown'})`)
  }
  if (asyncChunks.length < budgets.minAsyncChunks) {
    failures.push(`Async chunk count ${asyncChunks.length} < minimum ${budgets.minAsyncChunks}`)
  }

  return {
    ok: failures.length === 0,
    entry: relative(distBase, entry).split(sep).join('/'),
    entryRaw,
    entryRawLimit: budgets.entryRaw,
    entryGzip,
    entryGzipLimit: budgets.entryGzip,
    asyncChunkCount: asyncChunks.length,
    minAsyncChunks: budgets.minAsyncChunks,
    largestAsyncRaw,
    maxAsyncChunkLimit: budgets.maxAsyncChunk,
    failures
  }
}

function printReport(report) {
  console.log('BUNDLE BUDGET PASSED')
  console.log(`Entry: ${report.entry}`)
  console.log(`Entry raw: ${report.entryRaw} / ${report.entryRawLimit} bytes`)
  console.log(`Entry gzip: ${report.entryGzip} / ${report.entryGzipLimit} bytes`)
  console.log(`Async JS chunks: ${report.asyncChunkCount} / minimum ${report.minAsyncChunks}`)
  console.log(`Largest async JS: ${report.largestAsyncRaw} / ${report.maxAsyncChunkLimit} bytes`)
}

function isCliMain() {
  if (!process.argv[1]) return false
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
  } catch {
    return false
  }
}

if (isCliMain()) {
  try {
    const report = inspectBundle(resolve(process.cwd(), 'dist'))
    if (report.ok) {
      printReport(report)
    } else {
      console.error('BUNDLE BUDGET FAILED')
      for (const failure of report.failures) {
        console.error(`- ${failure}`)
      }
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`BUNDLE BUDGET ERROR: ${error.message}`)
    process.exitCode = 1
  }
}
