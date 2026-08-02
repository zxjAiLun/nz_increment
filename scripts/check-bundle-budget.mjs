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

/** 将 index.html 中的 script src 安全解析到 distDir 内的实际路径；逃逸 / 非法时抛错。 */
function resolveEntryPath(distDir, src) {
  const base = resolve(distDir)
  // src 可能形如 assets/index-xxx.js 或 /assets/index-xxx.js（Vite 产物相对 index.html 均以 assets/ 开头）
  const cleaned = String(src).replace(/^[/\\]+/, '')
  const target = resolve(base, cleaned)
  const rel = relative(base, target)
  if (rel.startsWith('..') || rel === '' && cleaned !== '' || rel.split(sep).includes('..')) {
    throw new Error(`Bundle budget: 入口路径逃逸 dist: ${src}`)
  }
  return target
}

/** 递归收集 distDir 下全部 .js 文件路径。 */
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
  const indexPath = join(distDir, 'index.html')
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

  const entry = resolveEntryPath(distDir, moduleSrcs[0])
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new Error(`Bundle budget: 入口文件不存在: ${entry}`)
  }

  const entryRaw = statSync(entry).size
  const entryGzip = gzipSync(readFileSync(entry)).length

  const asyncChunks = collectJsFiles(distDir).filter(p => p !== entry)
  const largestAsyncRaw = asyncChunks.length
    ? Math.max(...asyncChunks.map(p => statSync(p).size))
    : 0
  const largestAsyncFile = asyncChunks.length
    ? asyncChunks.find(p => statSync(p).size === largestAsyncRaw)
    : null

  const failures = []
  if (entryRaw > budgets.entryRaw) {
    failures.push(`Entry raw ${entryRaw} > limit ${budgets.entryRaw} bytes (${relative(distDir, entry)})`)
  }
  if (entryGzip > budgets.entryGzip) {
    failures.push(`Entry gzip ${entryGzip} > limit ${budgets.entryGzip} bytes`)
  }
  if (largestAsyncRaw > budgets.maxAsyncChunk) {
    failures.push(`Async chunk ${largestAsyncRaw} > limit ${budgets.maxAsyncChunk} bytes (${largestAsyncFile ? relative(distDir, largestAsyncFile) : 'unknown'})`)
  }
  if (asyncChunks.length < budgets.minAsyncChunks) {
    failures.push(`Async chunk count ${asyncChunks.length} < minimum ${budgets.minAsyncChunks}`)
  }

  return {
    ok: failures.length === 0,
    entry: relative(distDir, entry),
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
