# Phase 3.16 交付报告 — Rune 静态旧模型彻底下线、唯一生产模型边界与防回归护栏

> 本文件已**提交供远端 Review 查阅**（含本 Phase 3.16.1 后续修正）。
> 允许修改范围（§16）：删除 `src/data/runes.ts`；修改 `src/stores/runeStore.ts` 架构注释；
> 最小修改 `src/stores/phase36_equipmentRunes.test.ts`；新增 `src/stores/phase316_runeModelBoundary.test.ts`。
> 生产代码（playerStore / RuneInventoryTab / equipmentRunes / runeGeneration / runeInventoryView / runeExperience / runeFeeding / runeLocking / runeDrop / killDrops / scripts/balance-report.mjs / reports/balance-report.md）零改动。

## 1. 目标与边界（§1–§2）

Phase 3.16 是 **Rune 静态旧模型彻底下线 + 唯一生产模型边界护栏**，纯架构清理，**不实现任何新玩法**：
- 删除遗留静态 `src/data/runes.ts`（`RUNES` / `RUNE_SETS` / 旧 `interface Rune`）。
- 确认所有生产路径继续使用唯一动态模型（`runeStore.ts` 的 `Rune`）。
- 新增源码级防回归测试，阻止静态 catalog / 第二套 Rune 模型在未来被误导入。
- **明确禁止扩展**（§2）：Rune 套装效果、RUNE_SETS 替代、合成、回收、容量、图鉴、预制商店、静态掉落表、套装属性加成、新字段、新存档、新 localStorage key。未进入 Phase 3.17。

## 2. 提交与文件变更（§3/§16/§21）

| 项 | 值 |
|----|----|
| base SHA | `1595734a937e9cb3716f118dc5444009fa51823d` |
| 本次提交 SHA | `e5bed9a489b2c687e7373d67a83b8c4aba724eb2` |
| 远端 `refs/heads/main` | `e5bed9a489b2c687e7373d67a83b8c4aba724eb2`（ls-remote 确认） |
| 一致性 | ✅ 远端 SHA === 本地 HEAD（推送后一致） |
| 删除文件 | `src/data/runes.ts`（31 行，含旧 `interface Rune` / `RUNES` / `RUNE_SETS`） |
| 新增文件 | `src/stores/phase316_runeModelBoundary.test.ts` |
| 修改文件 | `src/stores/runeStore.ts`（仅架构注释）、`src/stores/phase36_equipmentRunes.test.ts`（最小收口） |

## 3. 删除前全部引用核查（§3/§20）

删除前对 `src` 全量检索结果（均为真实引用，删除后须清零）：

- **`data/runes` 真实引用（2 处）**：
  - `src/stores/phase36_equipmentRunes.test.ts:38` — `import { RUNES } from '../data/runes'`（真实 import，已收口）
  - `src/stores/runeStore.ts:16` — 架构注释中过渡描述「UI 展示不再使用 src/data/runes.ts」（已改写为确定性单一来源说明）
- **`RUNES` / `RUNE_SETS` 真实声明（2 处，均在被删文件内）**：
  - `src/data/runes.ts:13` — `export const RUNES: Rune[] = [...]`
  - `src/data/runes.ts:25` — `export const RUNE_SETS = {...}`
- **`interface Rune` 真实声明（2 处）**：
  - `src/data/runes.ts:3` — 旧静态 `interface Rune`（含 name/primaryStat/secondaryStat/setBonus/color）
  - `src/stores/runeStore.ts:39` — 生产 `interface Rune`（id/type/rarity/level/exp/statValue/isLocked），保留

删除后其余 `data/runes` / `RUNES` 命中（见 §9/§10 证据）**全部为注释或测试说明文字**，非真实导入/声明，按 §15/§20 原则保留（不删除有价值的历史说明）。

## 4. Phase 3.6 测试最小适配（§6）

`src/stores/phase36_equipmentRunes.test.ts` 仅做最小收口，未削弱任何装备 Rune 行为断言：
- 删除 `import { RUNES } from '../data/runes'`（旧静态文件已删除）。
- 新增本地字面量 `const STATIC_RUNES_ATK_ID = 'rune_atk_1'`（即原 `RUNES[0].id`），替换 4 处 `RUNES[0].id` 用法（行 576 / 1050 / 1118 / 1125）。
- 保留全部 Phase 3.6 核心验收：装备 Rune slot 行为、动态 inventory、Rune 属性聚合、静态 `RUNES` 驱动的断言改为「该 id 不再解析为动态 Rune」的等价证明（“含静态 RUNES id”测试说明文字保留）。
- **结果**：`phase36` 回归 **94 passed**，无删减弱化。

## 5. runeStore 唯一生产模型说明（§4/§5）

`src/stores/runeStore.ts` 架构注释由过渡描述「UI 展示不再使用 src/data/runes.ts 的静态 Rune 身份模型」改写为：
> Rune、RuneType 与 RuneRarity 是生产代码唯一 Rune 领域模型。所有 Rune 均通过动态生成、校验与 playerStore inventory 管理；生产代码不得重新引入静态 Rune catalog（旧 src/data/runes.ts 与其 RUNES / RUNE_SETS 已彻底下线，见 phase316 架构护栏）。

**未修改**任何 `interface` / 常量 / 函数 / 运行时代码；`Rune` 字段（id/type/rarity/level/exp/statValue/isLocked）语义与存档形态保持不变（§4）。

## 6. 旧路径 import 扫描证据（§9）

`phase316` 测试对 `src/**/*.{ts,vue}` 递归扫描（排除测试自身），使用 strip 注释后的内容匹配：
`import ... from '...data/runes'` / `export ... from '...data/runes'` / `require('...data/runes')` / `await import('...data/runes')` 及 `/data/runes.ts`、`/data/runes/index`。
- **结果**：命中数 = **0**。删除后仅存注释/说明文字（如 runeStore 注释「旧 src/data/runes.ts」、phase36 注释），均非导入语句，strip 后不命中。
- 失败信息会列出命中文件与表达式（本阶段无命中）。

## 7. RUNES / RUNE_SETS 生产声明为零证据（§10）

对生产 `.ts/.vue`（排除 `*.test.ts`）扫描独立标识符声明 `(?:export\s+)?const\s+(?:RUNES|RUNE_SETS)\b`（单词边界，不误伤 `runes`/`nextRunes`/`selectedRunes`/`tryFeedRunes`）。
- **结果**：命中数 = **0**。删除后生产代码无 `export const RUNES` / `const RUNES` / `RUNE_SETS` 声明；注释「不再用静态 RUNES」因 strip 注释不受影响。

## 8. 独立生产 interface/type Rune 唯一性证据（§11）

对生产 `.ts/.vue`（排除 `*.test.ts`）扫描 `(?:export\s+)?interface\s+Rune\s*\{` 与 `(?:export\s+)?type\s+Rune\b\s*=\s*\{`（单词边界，不误伤 `RuneInventoryRow` 等以 Rune 为前缀的接口）。
- **结果**：命中数 = **1**，且唯一命中文件 = `src/stores/runeStore.ts`。旧 `src/data/runes.ts` 的 `interface Rune` 已随文件删除，确认无第二套生产 Rune 模型。

## 9. 动态 Rune canonical 运行时 smoke 证据（§13）

`phase316` 不写盘 / 不调用 RNG / 不挂载 UI / 不使用 playerStore，验证删除静态文件后动态链仍正常：
- `validateRune(rune)` → `ok:true`（完整 Rune 校验成功）
- `validateRuneInventory([rune])` → `ok:true`（inventory 校验成功）
- `buildRuneInventoryView([rune], {})` → `ok:true`，`rows[0].rune.id === 'phase316-r1'`、`isLocked === false`（canonical ID / isLocked 保持）
- `planRuneLockChange({ inventory:[rune], runeId, isLocked:true })` → `ok:true`，`nextRune.id` 保持、`nextRune.isLocked === true`、`changed === true`（锁定 planner 可生成合法计划）

**无 RNG / 无 storage 写入证据**：smoke 块内 `vi.spyOn(Math,'random')` 与 `vi.spyOn(Storage.prototype,'setItem')` 均断言 `not.toHaveBeenCalled`（§18）。

## 10. Rune 类型编译边界证据（§12）

`phase316` 从 `./runeStore` 导入 `type { Rune, RuneType, RuneRarity }` 并构造完整动态 fixture：
```ts
const rune: Rune = { id:'phase316-r1', type:'attack', rarity:'rare', level:1, exp:0, statValue:10, isLocked:false }
```
该导入与 fixture 经 `npm run build`（vue-tsc）类型检查通过，证明 `Rune` / `RuneType` / `RuneRarity` 仍由唯一生产模块 `src/stores/runeStore.ts` 正常提供；未增加新 barrel re-export。
> 注：项目未安装 `@types/node`（§7 禁止新增第三方依赖），`node:fs`/`node:path`/`process` 在测试文件内以 `// @ts-ignore` 抑制 vue-tsc 报错、运行时由 Node 原生提供，所有 node 引用严格限制在 phase316 单个新文件内，未改动 tsconfig 或新增依赖。

## 11. 生产依赖 smoke 证据（§14）

`phase316` 读取以下生产文件源码并断言不含 `data/runes` 旧路径：
`utils/equipmentRunes.ts` / `utils/runeGeneration.ts` / `utils/runeInventoryView.ts` / `utils/runeExperience.ts` / `utils/runeFeeding.ts` / `utils/runeLocking.ts` —— 全部 `src.includes('data/runes') === false`。

## 12. 验收门证据（§19）

| 门 | 命令 | 结果 |
|----|------|------|
| §19-1 新测试 | `npm test -- --run src/stores/phase316_runeModelBoundary.test.ts` | ✅ **11 passed (11)** |
| §19-2 3.6 回归 | `npm test -- --run src/stores/phase36_equipmentRunes.test.ts` | ✅ **94 passed (94)** |
| §19-3 3.12–3.15 | `npm test -- --run phase312+phase313+phase314+phase315` | ✅ **222 passed (222)** |
| §19-4 默认全量 | `npm test -- --run` | ✅ **1470 passed (1470)**，64 文件，0 fail |
| §19-5 30s 档 | `npm test -- --run --testTimeout=30000` | ✅ **1470 passed (1470)**，0 fail |
| §19-6 构建 | `rm -rf dist && npm run build`（vue-tsc + vite） | ✅ vue-tsc 类型检查通过（含 .test.ts），vite 构建成功 |
| §19-7 平衡 | `npm run balance-check` | ✅ **0 fail / 0 warning** |
| §19-7 校验 | `npm run balance-report:verify` | ✅ 逐字节一致（144 行, 1000 runs/点） |
| §19-8 diff | `git diff --cached --check` | ✅ exit 0（无尾随空白/EOF 空行问题） |

**禁止项核查（§19）**：无 `skip`/`only`/`todo`；未提高全局 timeout（仅用 `--testTimeout=30000` 复跑以规避已知 parity flake）；未改动 `runtimeSimulatorParity`；未使用 `--passWithNoTests`；未放宽 verifier。

## 13. diff 审计（§20）

- `git grep -n "data/runes" -- src` → 仅余注释（phase36:38、runeStore:18），无真实导入/导出。
- `git grep -n -E "\b(RUNES|RUNE_SETS)\b" -- src` → 仅余注释与测试说明文字（EquipmentDetailModal.vue / equipmentRunes.ts / phase36 / runeStore），无生产 `export const RUNES`/`RUNE_SETS` 声明。
- `src/data/runes.ts` 状态为 `D`（deleted），无同内容改名文件，无 compatibility shim，无新 static catalog。
- `reports/balance-report.md` 不在 `git status` 变更中（verify 逐字节一致，未变化）。

## 14. 生产代码改动声明

**零改动。** 除删除 `src/data/runes.ts` 与修改 `runeStore.ts` 架构注释外，未触碰任何生产运行时代码；玩家存档、UI、动态生成/入库/镶嵌/经验/吞噬/锁定/筛选全部行为不变（§17）。

## 15. 测试文件规模

- `src/stores/phase316_runeModelBoundary.test.ts`：新增，覆盖 §8–§14，共 **11 个测试用例**。
- `src/stores/phase36_equipmentRunes.test.ts`：94 用例（最小收口，数量不变）。

---

## 16. Phase 3.16.1 后续修正（扫描增强 + 自测）

> 基于远端 `main = 74d8b0c`（即 Phase 3.16 报告提交）继续，不进入 Phase 3.17。

### 16.1 目标

仅做两件事（允许修改范围仅 2 文件：`PHASE_3_16_DELIVERY.md`、`src/stores/phase316_runeModelBoundary.test.ts`）：

1. 报告开头「未跟踪、不进入版本库」改为「已提交供远端 Review 查阅」。
2. 增强 `phase316` 旧路径扫描，使其额外识别 `import('../data/runes')`（裸动态 import）与 `import '../data/runes'`（副作用 import）；
   将扫描逻辑提取为共享 helper `findOldPathHits`；新增正例/反例自测。

### 16.2 扫描正则增强（§9）

旧正则仅覆盖 `import ... from`、`export ... from`、`require(...)`、`await import(...)`。
新增两条分支，共识别 6 种形式：

```ts
/(?:\bimport\b[^;]*?\bfrom\s*['"]   // 静态具名导入  import { X } from '../data/runes'
  |\bimport\b\s*['"]                // 副作用导入    import '../data/runes'
  |\bexport\b[^;]*?\bfrom\s*['"]   // 重导出        export * from '../data/runes'
  |\bimport\s*\(['"]               // 裸动态导入    import('../data/runes')
  |\bawait\s+\bimport\s*\(['"]     // 带 await 动态 import('../data/runes')
  |\brequire\s*\(['"]              // CommonJS     require('../data/runes')
)[^'"]*data\/runes[^'"]*['"]/g
```

`findOldPathHits(content)`：先 `stripComments` 再去重扫描，返回所有命中表达式（trim）。

### 16.3 自测（正例抓住 / 反例不误报）

正例（各命中 1 处）：
`import { RUNES } from '../data/runes'`、`import '../data/runes'`、`export * from '../data/runes'`、
`await import('../data/runes')`、`import('../data/runes')`、`require('../data/runes')`。

反例（各命中 0 处，确认不误报）：
行注释 `// 注释里的 import('../data/runes') 不应被扫描命中`（被 stripComments 移除）、
`import { Rune } from './runeStore'`、`const nextRunes = []`、`playerStore.tryFeedRunes('a', ['b'])`。

### 16.4 提交与门禁结果

| 项 | 值 |
|----|----|
| base SHA（Phase 3.16 报告提交） | `74d8b0c701be6c7c0592d182d830ebc81dd71d1c` |
| 本次提交 SHA | _（推送后回填）_ |
| 远端 `refs/heads/main` | _（ls-remote 确认后回填）_ |
| 一致性 | _（待确认：远端 SHA === 本地 HEAD）_ |
| 修改文件 | `src/stores/phase316_runeModelBoundary.test.ts`（扫描增强 + 自测）、`PHASE_3_16_DELIVERY.md`（开头措辞 + 本小节） |

门禁（同 §19，全绿）：

- `phase316` 单文件：**21 passed**（原 11 + 新增 10 自测）
- `phase36`：**94 passed**（不变）
- `phase312+313+314+315`：**222 passed**（不变）
- 默认全量：**1470 passed**，0 fail
- 30s 档：**1470 passed**，0 fail
- `npm run build`：vue-tsc + vite ✅
- `balance-check`：**0 fail / 0 warning**
- `balance-report:verify`：逐字节一致 ✅
- `git diff --check`：exit 0

**禁止项核查**：无 `skip`/`only`/`todo`；未提高全局 timeout；未改 `runtimeSimulatorParity`；未用 `--passWithNoTests`；未放宽 verifier。
