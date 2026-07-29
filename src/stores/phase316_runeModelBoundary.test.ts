// Phase 3.16 — Rune 静态旧模型彻底下线、唯一生产模型边界与防回归护栏
//
// 本测试运行在 Node/Vitest 环境，使用 node:fs / node:path / process.cwd()。
// 不新增第三方依赖。它从源码层面证明：
//   §8   src/data/runes.ts 已彻底删除；唯一生产模型文件仍存在
//   §9   旧路径 import/export/动态 import（含裸 import 与副作用 import）/require 为零
//   §10  生产代码中独立 RUNES / RUNE_SETS 声明为零
//   §11  生产代码中独立的 interface/type Rune 仅在 runeStore.ts 一处
//   §12  Rune / RuneType / RuneRarity 仍从 runeStore.ts 唯一编译导入
//   §13  删除静态文件后，动态 Rune 链（validateRune/Inventory/view/lock planner）smoke 成功
//   §14  关键生产工具文件不再包含旧静态路径 import
//
// 特征：不写盘、不调用 RNG、不挂载 UI、不使用 playerStore。
// 仅约束“当前生产源码 + 当前可执行测试导入”；历史文档中的旧名称不在扫描范围（§15）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// 项目未安装 @types/node（§7 禁止新增第三方依赖），node 内置模块类型在运行环境（Node/Vitest）
// 由 Node 原生提供；此处仅用 @ts-ignore 抑制 vue-tsc 对缺失 node 类型的报错，运行时完全可用。
// @ts-ignore node 内置模块无 @types/node（§7 禁止新增依赖；运行时由 Node 提供）
import { existsSync, readFileSync, readdirSync } from 'node:fs'
// @ts-ignore 同上
import { resolve } from 'node:path'
import type { Rune, RuneType, RuneRarity } from './runeStore'
declare const process: { cwd(): string }
import { validateRune, validateRuneInventory } from '../utils/equipmentRunes'
import { buildRuneInventoryView } from '../utils/runeInventoryView'
import { planRuneLockChange } from '../utils/runeLocking'

const SRC = resolve(process.cwd(), 'src')

// —— 源码遍历 ——
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = resolve(dir, e.name)
    if (e.isDirectory()) {
      // 不进入 node_modules / dist 等非 src 子目录（src 下均为源码）
      out.push(...collectSourceFiles(full))
    } else if (e.isFile()) {
      if (full.endsWith('.ts') || full.endsWith('.vue')) out.push(full)
    }
  }
  return out
}

const allSource = collectSourceFiles(SRC)
const selfPath = resolve(SRC, 'stores/phase316_runeModelBoundary.test.ts')

// §9 扫描旧路径时排除本测试文件自身（其字符串中描述禁用路径属正常）
const scannedForOldPaths = allSource.filter(f => f !== selfPath)
// §10 / §11 仅扫描生产代码，排除所有 *.test.ts
const productionFiles = allSource.filter(f => !f.endsWith('.test.ts'))

// 去掉注释，避免说明性文字（如"不再用静态 RUNES"）被误判为声明/导入
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/\/\/[^\n]*/g, '') // 行注释
}

// —— §9 旧路径扫描共享 helper ——
// 识别指向 src/data/runes 的以下旧路径引用形式：
//   import { X } from '../data/runes'     静态具名导入
//   import '../data/runes'                副作用导入（无 from）
//   export * from '../data/runes'         重导出
//   await import('../data/runes')         带 await 动态导入
//   import('../data/runes')               裸动态导入（无 await）
//   require('../data/runes')              CommonJS require
// 先去注释，避免说明性文字被误判；返回所有命中表达式（已 trim）。
const OLD_PATH_RE =
  /(?:\bimport\b[^;]*?\bfrom\s*['"]|\bimport\b\s*['"]|\bexport\b[^;]*?\bfrom\s*['"]|\bimport\s*\(['"]|\bawait\s+\bimport\s*\(['"]|\brequire\s*\(['"])[^'"]*data\/runes[^'"]*['"]/g

function findOldPathHits(content: string): string[] {
  const cleaned = stripComments(content)
  const hits: string[] = []
  let m: RegExpExecArray | null
  OLD_PATH_RE.lastIndex = 0
  while ((m = OLD_PATH_RE.exec(cleaned)) !== null) {
    hits.push(m[0].trim())
  }
  return hits
}

// —— §8 删除证据 + 生产文件存在证据 ——
describe('Phase 3.16 — 静态旧模型删除与生产文件存在性（§8）', () => {
  it('src/data/runes.ts 已彻底删除', () => {
    expect(existsSync(resolve(SRC, 'data/runes.ts'))).toBe(false)
  })

  it('唯一生产模型关键文件均仍存在', () => {
    for (const rel of [
      'stores/runeStore.ts',
      'utils/equipmentRunes.ts',
      'utils/runeGeneration.ts',
      'utils/runeInventoryView.ts'
    ]) {
      expect(existsSync(resolve(SRC, rel)), `生产文件应存在: ${rel}`).toBe(true)
    }
  })
})

// —— §9 禁止旧路径导入 ——
describe('Phase 3.16 — 禁止旧路径 import / export / 动态 import / require（§9）', () => {
  it('所有生产 .ts/.vue 均不含指向 src/data/runes 的导入/导出/动态导入/require', () => {
    const hits: Array<{ file: string; expr: string }> = []
    for (const file of scannedForOldPaths) {
      for (const expr of findOldPathHits(readFileSync(file, 'utf8'))) {
        hits.push({ file, expr })
      }
    }
    if (hits.length > 0) {
      const detail = hits.map(h => `  ${h.file}\n    ${h.expr}`).join('\n')
      throw new Error(`发现旧路径 data/runes 导入/导出（共 ${hits.length} 处）：\n${detail}`)
    }
    expect(hits.length).toBe(0)
  })
})

// —— §9 扫描逻辑自测：正例必须抓住、反例不得误报 ——
describe('Phase 3.16 — 旧路径扫描 helper 自测（正例抓住 / 反例不误报）', () => {
  const positive = [
    `import { RUNES } from '../data/runes'`,
    `import '../data/runes'`,
    `export * from '../data/runes'`,
    `await import('../data/runes')`,
    `import('../data/runes')`,
    `require('../data/runes')`
  ]
  const negative = [
    `// 注释里的 import('../data/runes') 不应被扫描命中`,
    `import { Rune } from './runeStore'`,
    `const nextRunes = []`,
    `playerStore.tryFeedRunes('a', ['b'])`
  ]

  positive.forEach((snippet, i) => {
    it(`正例[${i}] 识别旧路径形式：${snippet}`, () => {
      const hits = findOldPathHits(snippet)
      expect(hits.length, `应命中 1 处，实际: ${JSON.stringify(hits)}`).toBe(1)
    })
  })

  negative.forEach((snippet, i) => {
    it(`反例[${i}] 不误报：${snippet}`, () => {
      const hits = findOldPathHits(snippet)
      expect(hits.length, `不应命中，实际: ${JSON.stringify(hits)}`).toBe(0)
    })
  })
})

// —— §10 禁止静态 catalog 重新出现 ——
describe('Phase 3.16 — 禁止生产 RUNES / RUNE_SETS 声明（§10）', () => {
  // 仅匹配独立标识符声明，不误伤 runes/nextRunes/selectedRunes/tryFeedRunes 等（全小写 r）
  const STATIC_CATALOG_RE = /(?:export\s+)?const\s+(?:RUNES|RUNE_SETS)\b/

  it('生产代码中不存在 export const RUNES / const RUNES / RUNE_SETS 声明', () => {
    const hits: Array<{ file: string; line: string }> = []
    for (const file of productionFiles) {
      const cleaned = stripComments(readFileSync(file, 'utf8'))
      for (const line of cleaned.split('\n')) {
        if (STATIC_CATALOG_RE.test(line)) {
          hits.push({ file, line: line.trim() })
        }
      }
    }
    if (hits.length > 0) {
      const detail = hits.map(h => `  ${h.file}\n    ${h.line}`).join('\n')
      throw new Error(`发现静态 catalog 声明（共 ${hits.length} 处）：\n${detail}`)
    }
    expect(hits.length).toBe(0)
  })
})

// —— §11 禁止第二个生产 Rune interface ——
describe('Phase 3.16 — 独立生产 interface/type Rune 唯一性（§11）', () => {
  const RUNE_INTERFACE_RE = /(?:export\s+)?interface\s+Rune\s*\{/
  const RUNE_TYPE_RE = /(?:export\s+)?type\s+Rune\b\s*=\s*\{/

  it('interface Rune / type Rune = { 仅在 src/stores/runeStore.ts 一处', () => {
    const hits: Array<{ file: string; expr: string }> = []
    for (const file of productionFiles) {
      const cleaned = stripComments(readFileSync(file, 'utf8'))
      const iface = RUNE_INTERFACE_RE.exec(cleaned)
      const ttype = RUNE_TYPE_RE.exec(cleaned)
      if (iface) hits.push({ file, expr: iface[0].trim() })
      if (ttype) hits.push({ file, expr: ttype[0].trim() })
    }
    const runeStorePath = resolve(SRC, 'stores/runeStore.ts')
    // 必须恰好命中一处，且该处就是 runeStore.ts
    expect(
      hits.length,
      `期望仅 runeStore.ts 一处独立 Rune 领域模型，实际命中：${JSON.stringify(hits)}`
    ).toBe(1)
    expect(hits[0].file).toBe(runeStorePath)
  })
})

// —— §12 动态模型编译边界 ——
describe('Phase 3.16 — Rune / RuneType / RuneRarity 唯一生产模块导入（§12）', () => {
  it('从 runeStore 导入并构造完整动态 Rune fixture（编译期由 vue-tsc 校验）', () => {
    const rune: Rune = {
      id: 'phase316-r1',
      type: 'attack',
      rarity: 'rare',
      level: 1,
      exp: 0,
      statValue: 10,
      isLocked: false
    }
    // 类型已导入且字段完整：编译通过即证明；此处做最小运行时形状校验
    expect(rune.id).toBe('phase316-r1')
    expect(rune.type).toBe('attack')
    expect(rune.rarity).toBe('rare')
    expect(rune.isLocked).toBe(false)

    // 同时证明 RuneType / RuneRarity 类型可用（构造字面量类型值）
    const t: RuneType = 'luck'
    const r: RuneRarity = 'legend'
    expect(t).toBe('luck')
    expect(r).toBe('legend')
  })
})

// —— §13 canonical 运行时 smoke（无 RNG / 无 storage / 无 UI / 无 playerStore）——
describe('Phase 3.16 — 动态 Rune canonical 运行时 smoke（§13）', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 证明 smoke 全程不调用 RNG、不写盘（§13/§18）
    randomSpy = vi.spyOn(Math, 'random')
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    expect(randomSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  const rune: Rune = {
    id: 'phase316-r1',
    type: 'attack',
    rarity: 'rare',
    level: 1,
    exp: 0,
    statValue: 10,
    isLocked: false
  }

  it('validateRune 完整校验成功', () => {
    const v = validateRune(rune)
    expect(v.ok).toBe(true)
  })

  it('validateRuneInventory inventory 校验成功', () => {
    const inv = validateRuneInventory([rune])
    expect(inv.ok).toBe(true)
  })

  it('buildRuneInventoryView 构建成功且 canonical ID / isLocked 保持', () => {
    const view = buildRuneInventoryView([rune], {})
    expect(view.ok).toBe(true)
    if (!view.ok) throw new Error('view 应为 ok')
    expect(view.rows.length).toBe(1)
    expect(view.rows[0].rune.id).toBe('phase316-r1') // canonical ID 保持
    expect(view.rows[0].rune.isLocked).toBe(false) // isLocked 保持
  })

  it('planRuneLockChange 可生成合法锁定计划（动态链不依赖静态文件）', () => {
    const plan = planRuneLockChange({ inventory: [rune], runeId: rune.id, isLocked: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('plan 应为 ok')
    expect(plan.nextRune.id).toBe('phase316-r1')
    expect(plan.nextRune.isLocked).toBe(true) // 锁定目标生效
    expect(plan.changed).toBe(true)
  })
})

// —— §14 生产工具文件不依赖旧静态路径 ——
describe('Phase 3.16 — 关键生产工具文件无旧静态路径 import（§14）', () => {
  const REL_FILES = [
    'utils/equipmentRunes.ts',
    'utils/runeGeneration.ts',
    'utils/runeInventoryView.ts',
    'utils/runeExperience.ts',
    'utils/runeFeeding.ts',
    'utils/runeLocking.ts'
  ]

  it('以上生产文件源码均不含 data/runes 旧路径', () => {
    for (const rel of REL_FILES) {
      const full = resolve(SRC, rel)
      expect(existsSync(full), `应为现有生产文件: ${rel}`).toBe(true)
      const src = readFileSync(full, 'utf8')
      expect(
        src.includes('data/runes'),
        `生产文件不应引用旧静态路径 data/runes: ${rel}`
      ).toBe(false)
    }
  })
})
