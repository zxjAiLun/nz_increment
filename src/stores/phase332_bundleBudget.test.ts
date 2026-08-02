// @ts-ignore
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
// @ts-ignore
import { join, dirname, resolve } from 'node:path'
// @ts-ignore
import { tmpdir } from 'node:os'
// @ts-ignore
import { randomBytes } from 'node:crypto'
import { describe, it, expect, afterEach } from 'vitest'
// @ts-ignore —— .mjs 脚本无类型声明（行为契约由本测试文件覆盖）
import { inspectBundle, DEFAULT_BUDGETS } from '../../scripts/check-bundle-budget.mjs'
// @ts-ignore
declare const process: { cwd(): string; chdir(dir: string): void }

/**
 * Phase 3.32 — Bundle Budget 检查脚本行为契约与 CI 硬门护栏。
 *
 * 用临时目录构造最小 dist/（不运行真实 vite build），直接调用 inspectBundle：
 *   1. 合法单入口、预算内、异步 chunk 数量足够 → 通过；
 *   2. 入口 raw 超限 → 失败且包含 actual/limit；
 *   3. 入口 gzip 超限 → 失败（node:zlib 计算）；
 *   4. 某个非入口 chunk 超限 → 失败且指出文件名；
 *   5. 非入口 chunk 数量不足 → 失败；
 *   6. 缺少 module script → fail-closed；
 *   7. 多个入口 module script → fail-closed；
 *   8. 入口文件不存在 → fail-closed；
 *   9. ../ 路径逃逸 dist → fail-closed；
 *  10. 恰好位于预算边界 → 允许通过；
 *  11. 非根 base、query/hash、外部 URL、编码 traversal、路径歧义和相对 distDir。
 *
 * 架构护栏：package.json 含 bundle-budget script；CI 在 Build 后执行 Bundle Budget、
 * 且在 Balance Verify 前；CI 步骤无 continue-on-error；vite.config.ts 未设置
 * chunkSizeWarningLimit 绕过预算。
 */

const ROOT = process.cwd()

function makeDistAt(base: string, files: Record<string, string | Uint8Array>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(base, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}

function makeDist(files: Record<string, string | Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p332-'))
  makeDistAt(dir, files)
  return dir
}

/** 生成 parent/dist 目录树（供相对 distDir 调用测试），返回 parent。 */
function makeDistTree(files: Record<string, string | Uint8Array>): string {
  const parent = mkdtempSync(join(tmpdir(), 'p332-'))
  makeDistAt(join(parent, 'dist'), files)
  return parent
}

const HTML = (src: string): string =>
  `<!doctype html><html><head><script type="module" src="${src}"></script></head><body></body></html>`

function smallAsyncChunks(count: number): Record<string, string> {
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    files[`assets/async-${i}.js`] = `// chunk ${i}\nconsole.log(${i})`
  }
  return files
}

const createdDirs: string[] = []

function track(dir: string): string {
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Phase 3.32 — check-bundle-budget 行为契约', () => {
  it('合法单入口、预算内、异步 chunk 数量足够 → 通过', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entry).toBe('assets/index.js')
    expect(report.asyncChunkCount).toBe(15)
    expect(report.failures).toEqual([])
  })

  it('入口 raw 超限 → 失败并包含 actual/limit', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'x'.repeat(DEFAULT_BUDGETS.entryRaw + 1),
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(false)
    const rawFailure = report.failures.find((f: string) => f.includes('Entry raw'))
    expect(rawFailure).toBeDefined()
    expect(rawFailure).toContain(String(DEFAULT_BUDGETS.entryRaw + 1))
    expect(rawFailure).toContain(String(DEFAULT_BUDGETS.entryRaw))
  })

  it('入口 gzip 超限 → 失败（node:zlib 计算）', () => {
    // 150000 字节高熵（gzip 不可压缩）→ gzip 体积 > 140000，raw 150000 在预算内
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': randomBytes(150000),
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(false)
    const gzipFailure = report.failures.find((f: string) => f.includes('Entry gzip'))
    expect(gzipFailure).toBeDefined()
    expect(report.entryGzip).toBeGreaterThan(DEFAULT_BUDGETS.entryGzip)
  })

  it('某个非入口 chunk 超限 → 失败并指出文件名', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        'assets/big.js': 'z'.repeat(DEFAULT_BUDGETS.maxAsyncChunk + 1),
        ...smallAsyncChunks(14)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(false)
    const asyncFailure = report.failures.find((f: string) => f.includes('Async chunk'))
    expect(asyncFailure).toBeDefined()
    expect(asyncFailure).toContain('big.js')
    expect(asyncFailure).toContain(String(DEFAULT_BUDGETS.maxAsyncChunk + 1))
  })

  it('非入口 chunk 数量不足 → 失败', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(5)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(false)
    const countFailure = report.failures.find((f: string) => f.includes('Async chunk count'))
    expect(countFailure).toBeDefined()
    expect(countFailure).toContain('5')
    expect(countFailure).toContain(String(DEFAULT_BUDGETS.minAsyncChunks))
  })

  it('缺少 module script → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': '<!doctype html><html><head><script src="assets/index.js"></script></head></html>',
        'assets/index.js': 'console.log("entry")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/未找到 type="module" 入口 script/)
  })

  it('多个入口 module script → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html':
          '<!doctype html><html><head>' +
          '<script type="module" src="assets/a.js"></script>' +
          '<script type="module" src="assets/b.js"></script>' +
          '</head></html>',
        'assets/a.js': 'console.log("a")',
        'assets/b.js': 'console.log("b")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/多个入口 module script/)
  })

  it('入口文件不存在 → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('assets/missing.js')
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/入口文件不存在/)
  })

  it('../ 路径逃逸 dist → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('../escape.js'),
        'assets/index.js': 'console.log("entry")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/逃逸/)
  })

  it('恰好位于预算边界 → 允许通过', () => {
    // 入口 raw 恰好 = 400000（严格大于才失败）；内容可压缩 → gzip 远低于预算
    const dir = track(
      makeDist({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'a'.repeat(DEFAULT_BUDGETS.entryRaw),
        ...smallAsyncChunks(DEFAULT_BUDGETS.minAsyncChunks)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entryRaw).toBe(DEFAULT_BUDGETS.entryRaw)
    expect(report.asyncChunkCount).toBe(DEFAULT_BUDGETS.minAsyncChunks)
    expect(report.failures).toEqual([])
  })

  // ==========================================================================
  // Phase 3.32 修复轮（P1）：支持 Vite 非根 base 路径（VITE_BASE_PATH=/game/ 等）
  // ==========================================================================
  it('/game/assets/index.js 正确解析到 dist/assets/index.js 并通过', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('/game/assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entry).toBe('assets/index.js')
  })

  it('/apps/game/assets/index.js（更深合法 base）正确解析并通过', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('/apps/game/assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entry).toBe('assets/index.js')
  })

  it('/assets/index.js（根 base 绝对路径）仍然通过', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('/assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entry).toBe('assets/index.js')
  })

  it('带 query/hash 的入口仍能解析：/game/assets/index.js?v=1#entry', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('/game/assets/index.js?v=1#entry'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const report = inspectBundle(dir)
    expect(report.ok).toBe(true)
    expect(report.entry).toBe('assets/index.js')
  })

  it('外部 URL 入口 → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('http://example.com/app.js'),
        'assets/index.js': 'console.log("entry")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/外部 URL/)
  })

  it('协议相对 URL 入口 → fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('//evil.example.com/app.js'),
        'assets/index.js': 'console.log("entry")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/协议相对/)
  })

  it('URL 编码 traversal（%2e%2e）→ fail-closed', () => {
    const dir = track(
      makeDist({
        'index.html': HTML('/%2e%2e/escape.js'),
        'assets/index.js': 'console.log("entry")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/逃逸/)
  })

  it('suffix 匹配出现多个候选 → fail-closed，不静默任选', () => {
    // src=/game/deep/assets/index.js 同时以 /deep/assets/index.js 与 /assets/index.js 结尾 → 歧义
    const dir = track(
      makeDist({
        'index.html': HTML('/game/deep/assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        'deep/assets/index.js': 'console.log("deep")'
      })
    )
    expect(() => inspectBundle(dir)).toThrow(/歧义/)
  })

  it('使用相对 distDir 调用时，入口不计入 asyncChunkCount', () => {
    const parent = track(
      makeDistTree({
        'index.html': HTML('assets/index.js'),
        'assets/index.js': 'console.log("entry")',
        ...smallAsyncChunks(15)
      })
    )
    const oldCwd = process.cwd()
    process.chdir(parent)
    try {
      const report = inspectBundle('./dist')
      expect(report.ok).toBe(true)
      expect(report.asyncChunkCount).toBe(15) // 入口未被重复计入
      expect(report.entry).toBe('assets/index.js')
    } finally {
      process.chdir(oldCwd)
    }
  })
})

describe('Phase 3.32 — Bundle Budget CI 硬门架构护栏', () => {
  it('package.json 存在 bundle-budget script', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['bundle-budget']).toBe('node scripts/check-bundle-budget.mjs')
  })

  it('CI 在 Build 后执行 Bundle Budget，且在 Balance Verify 前执行', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const buildIdx = ci.indexOf('- name: Build')
    const budgetIdx = ci.indexOf('- name: Bundle Budget')
    const verifyIdx = ci.indexOf('- name: Balance Report Verify')
    expect(buildIdx).toBeGreaterThanOrEqual(0)
    expect(budgetIdx).toBeGreaterThan(buildIdx)
    expect(verifyIdx).toBeGreaterThan(budgetIdx)
    expect(ci).toMatch(/- name: Bundle Budget\s+run: npm run bundle-budget/)
  })

  it('CI 在 Balance Verify 前执行独立的 /game/ Build 与 Bundle Budget', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const subBuildIdx = ci.indexOf('- name: Subpath Build')
    const subBudgetIdx = ci.indexOf('- name: Subpath Bundle Budget')
    const verifyIdx = ci.indexOf('- name: Balance Report Verify')
    expect(subBuildIdx).toBeGreaterThanOrEqual(0)
    expect(subBudgetIdx).toBeGreaterThan(subBuildIdx)
    expect(verifyIdx).toBeGreaterThan(subBudgetIdx)
    expect(ci).toMatch(
      /- name: Subpath Build\s+env:\s+VITE_BASE_PATH: \/game\/\s+run: npm run build/
    )
    expect(ci).toMatch(/- name: Subpath Bundle Budget\s+run: npm run bundle-budget/)
  })

  it('CI 步骤没有 continue-on-error（预算失败必须令 CI 红）', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    // 只检查配置项形式（continue-on-error: true），注释中提及该词不判失败
    expect(ci).not.toMatch(/continue-on-error\s*:/)
    expect(ci).not.toMatch(/\|\| true/)
  })

  it('vite.config.ts 未设置 chunkSizeWarningLimit 绕过预算', () => {
    const viteConfig = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
    expect(viteConfig).not.toMatch(/chunkSizeWarningLimit/)
    expect(viteConfig).not.toMatch(/manualChunks/)
  })
})
