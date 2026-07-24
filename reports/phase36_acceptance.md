# Phase 3.6 + 3.6.1 验收报告：装备符文单一模型 + 三孔迁移 + 原子镶嵌 + 真实属性闭环（含玩家级拓扑聚合收口）

> 本文件随 Phase 3.6.1 提交一起纳入仓库（远端可见），不再仅存于本地。

- **Phase 3.6.1 实现提交**：`86f7e7a4887ce8ea168703f3f63ccadd204a718f`（包含代码修复与初版验收报告；远端可见，见 `git log`）
- **实现基线**：`b69913c0cb9e4c31434e1e2e3778c95aeede9d3a`（Phase 3.6 提交，已由远端确认）
- **Phase 3.6 Base SHA**：`89260fa34a48581404a5b1583a1ceb7d3891981d`（Phase 3.5.1 远端 APPROVED 封板点）
- **本报告 Git 元数据纠正（Phase 3.6.2）**：在 `86f7e7a` 之后的后续提交中完成；具体纠正提交 SHA 以 `git log` 和最终交付消息为准（不通过 amend 追逐"文件包含自身 SHA"）
- **Review 结论处理**：远端对 `b69913c` 给出 **CHANGES REQUESTED**，指出两个同根 P1（缺玩家级全局拓扑上下文）。Phase 3.6.1 修复二者；Phase 3.6.2 仅纠正本报告 Git 元数据，**不进入 Rune 升级/经验/套装/生成掉落/合成/Phase 3.7**。

---

## 0. Phase 3.6.1 修复范围与根因

两个 P1 同根：**Rune 属性计算缺少玩家级全局拓扑上下文**。

- **P1-A（跨装备重复计算）**：`calculateTotalStats` 原在装备循环内逐件调用 `getEquipmentRuneBonuses`，同一 Rune 被两件装备引用时会被计算两次（`attack +20` 而非 `0`）。
- **P1-B（装备比较忽略 Rune）**：`compareEquipmentImpact` / `compareEquipmentPrecision` 调用 `calculateTotalStats` 未传 inventory，导致 DPS/生存/金币/构筑评分/精确战斗模拟均不含 Rune。

修复后：
1. 新增玩家级纯函数 `getPlayerEquipmentRuneBonuses(equipmentBySlot, inventory)`，在**全部装备全局上下文**中扫描拓扑、整层 fail-closed。
2. `calculateTotalStats` 改为循环结束后**一次性**调用该玩家级函数，禁止逐件累加。
3. `compareEquipmentImpact` / `compareEquipmentPrecision` 末位新增可选 `runeInventory?: Rune[]`，内部所有候选属性计算传入 inventory。
4. `EquipmentDetailModal.vue` 的 `impactRows` 与 `precisionImpact` 均传入 `playerStore.runeInventory`。

---

## 1. 变更文件（Phase 3.6.1，6 个路径：5 个代码/测试文件 + 1 个验收报告）

> 由 `git diff --name-status b69913c0cb9e4c31434e1e2e3778c95aeede9d3a 86f7e7a4887ce8ea168703f3f63ccadd204a718f` 确认。

| 类型 | 文件 | 作用 |
|---|---|---|
| 改 | `src/utils/equipmentRunes.ts` | 新增 `getPlayerEquipmentRuneBonuses` 玩家级聚合（复用 scan/validate/映射，不复制公式） |
| 改 | `src/utils/calc.ts` | `calculateTotalStats` 改为循环后一次性应用玩家级 Rune bonus；注释去除误导性"combatInsights 不传"措辞 |
| 改 | `src/utils/combatInsights.ts` | 两比较函数末位新增 `runeInventory?: Rune[]`，候选属性均传 inventory |
| 改 | `src/components/EquipmentDetailModal.vue` | `impactRows` / `precisionImpact` 传 `playerStore.runeInventory`，不访问静态 RUNES |
| 改 | `src/stores/phase36_equipmentRunes.test.ts` | 原 82 用例保留；新增 12 用例覆盖 P1-A/P1-B；改名误导性测试名 |
| 新增 | `reports/phase36_acceptance.md` | 远端验收证据与门禁结果记录 |

> 未触碰：`playerStore.ts` / `runeStore.ts` / `equipmentGenerator.ts`（与规格第 13 节一致，无必要接线；Phase 3.6.2 亦未修改任何 `src/` 文件）。

---

## 2. 玩家级 Rune bonus 聚合入口

- 唯一入口：`getPlayerEquipmentRuneBonuses(equipmentBySlot, inventory): StatBonus[]`（`equipmentRunes.ts`）。
- 复用既有纯函数，不复制公式或 type→stat 映射：
  - `validateRuneInventory(inventory)` → 非法 inventory 整层 `[]`
  - 按 `EQUIPMENT_SLOTS` 扫描，每件装备 `validateEquipmentRuneSlots` → 三孔损坏整层 `[]`
  - `scanRuneReferences` 建立 `runeId → 位置[]` 全局拓扑
  - 对每个 runeId：`refs.length > 1`（同装备/跨装备重复）→ `[]`；`!invById.get(id)`（悬空）→ `[]`；未知 `type/stat` → `[]`；`getRuneEffectiveValue` 非有限或为负 → `[]`
  - 全程 `try/catch` → 异常返回 `[]`；不修改任何输入、不抛异常

## 3. 跨装备重复 Rune 在 totalStats 中为零的证据（P1-A 修复）

- `calculateTotalStats` 不再在装备循环内累加符文，改为循环后 `for (const bonus of getPlayerEquipmentRuneBonuses(player.equipment, runeInventory))` 一次性累加。
- 测试 `weapon→r1, chest→r1, inventory 中 r1=attack+10` 直接 `calculateTotalStats(player, undefined, inventory)`（**不先 reconcile**）：
  - `withDup.attack - withoutRune.attack ≈ 0`（非 +20、非 +10）
  - 基础装备 stats 仍正常累加；所有字段有限；输入（equipment / inventory）完全不变

## 4. 重复 + 唯一混合时整层 fail-closed 证据（P1-A 强化）

- 构造 `weapon→r1, chest→r1, head→r2`（r2 为另一枚合法 Rune）。
- 断言：`r1` 与 `r2` **均不产生** Rune bonus（整层 `[]`，不得偷偷应用 r2）。
- 同时验证基础装备 stats 与精炼 bonus 仍生效（weapon 含 `+15` 精炼，与"无 rune 同精炼"基线一致；与"无 rune 无精炼"基线差 `+15`），证明 Rune 失败路径未吞掉精炼。

## 5. 合法多装备 Rune 恰好各计算一次的证据

- `weapon→r1(attack+10), chest→r2(attack+20), head→r3(health+50)`：
  - 聚合 `attack` 精确 `+30`、`maxHp` 精确 `+50`，每枚 Rune 只计算一次。
  - 装备在槽位间旋转（遍历顺序反转）后结果完全一致（拓扑由 `runeId` 派生，与槽位顺序无关）。
- `calculateTotalStats` 端同样验证 `attack +30 / maxHp +50`。

## 6. 装备影响 DPS / 金币变化证据（P1-B 修复）

- `compareEquipmentImpact(player, weaponB, weaponA, inventory)`：
  - 当前(weaponA) 带 `attack+100` Rune、候选(weaponB) 空孔 → **DPS delta 明确为负、金币/分钟 delta 明确为负**，且结果**不等于**忽略 Rune 时的 0。
  - 反向（当前空孔、候选带 Rune）→ DPS / 金币 delta 明确为正。

## 7. 精确战斗比较接入 Rune 的证据（P1-B 修复）

- `compareEquipmentPrecision(player, weaponB, monster, 60, weaponA, 10, inventory)`：
  - 当前(带高 attack Rune) 与候选(同基础无 Rune) 比较，传入 inventory 后 `deltaWinRate / deltaTtkSeconds / deltaTtlSeconds` 至少一项真实非零（当前击杀更快）。
  - 同一调用**不传** inventory（旧兼容结果）与传入 inventory 的结果**不同**（当前玩家属性含/不含 Rune → `current.averageTtkSeconds` 不同）。

## 8. 全局损坏 fail-closed（不抛、无 NaN）

- 覆盖：一件悬空 / 三孔长度错误 / slot index 错误 / inventory 重复 id / inventory 含非法 Rune（未知 type）。
- 即使其他装备拥有合法 Rune，整个 Rune bonus 层仍为空；`getPlayerEquipmentRuneBonuses` 不抛异常；`calculateTotalStats` 端所有字段 `Number.isFinite` 为真。

---

## 9.（继承）Phase 3.6 核心证据

- **唯一 Rune 模型**：删全局 5 槽 + `Rune.slotIndex`，绑定完全由 `equipment.runeSlots` 拓扑派生（详见上版报告第 2 节）。
- **三孔来源唯一** `createEmptyEquipmentRuneSlots()`，装备生成 RNG 顺序不变（上版报告第 3 节）。
- **inventory 单 key 持久化** `runeData.inventory` + `loadGame` 水合/迁移/对账（上版报告第 4 节）。
- **空数组/缺失三孔迁移**、**悬空/重复对账**、**跨装备移动原子**、**保存失败回滚**、**六种 type 真实属性**、**静态 RUNES 断链**、**套装未进属性**（上版报告第 5–11 节）均保留且未回归。

---

## 10. 测试结果

> 以下为 Phase 3.6.1 实现提交（`86f7e7a`）的既有验收结果。Phase 3.6.2 仅做 Markdown 元数据纠正，未重跑测试 / build / balance。

| 轮次 | 命令 | 结果 |
|---|---|---|
| 默认（5s 噪声报告） | `npm test -- --run` | **54 文件 / 947 用例**：1 失败仅 `runtimeSimulatorParity.test.ts` 帧率矩阵 5000ms 超时（已知重量级模拟噪声，**不视为真实失败**）；其余 946 通过 |
| 确定性 | `npm test -- --run --testTimeout=30000` | **54 测试文件 / 947 用例全绿** |

- 本阶段 `phase36_equipmentRunes.test.ts`：原 **82 用例未回归** + 新增 **12 用例**（P1-A/P1-B 全覆盖）= **94 用例全绿**。
- 重量级 `runtimeSimulatorParity.test.ts`：13 例（30s 轮全绿）。
- 重量级 `phase31_luck.test.ts`：34 例（luck 金币比 ∈ [1.10,1.40]，30s 轮全绿）。

## 11. 构建 / 平衡 / diff（Phase 3.6.1 既有验收结果）

> 以下为 Phase 3.6.1 实现提交（`86f7e7a`）的既有验收结果；Phase 3.6.2 未重跑代码门禁，不将上一轮结果伪装成本轮重新运行结果。

- `npm run build`：`vue-tsc` **0 error**；vite build 11.49s 通过。
- `balance-check`：**0 fail / 0 warning** ✅
- `balance-report:verify`：当前代码报告与 `reports/balance-report.md` **逐字节一致**（144 行，1000 runs/点）✅
- `git diff --check`（`b69913c → 86f7e7a`）：**CLEAN** ✅

## 11a. Phase 3.6.2 文档纠正轮 Git 校验

> 本轮仅修改 Markdown，未触碰任何 `src/` 文件，未重跑代码门禁。

| 校验 | 命令 | 结果 |
|---|---|---|
| 变更范围 | `git diff --name-status 86f7e7a4887ce8ea168703f3f63ccadd204a718f` | 仅 `M reports/phase36_acceptance.md` |
| 行尾空白 | `git diff --check 86f7e7a4887ce8ea168703f3f63ccadd204a718f` | **CLEAN** ✅ |
| 工作树 | `git status --short` | 仅 `reports/phase36_acceptance.md`（提交前） |

- 实际运行结果（含本次纠正提交 SHA 与同步状态 `0  0`）以最终交付消息为准；本次纠正提交 SHA 不写入本报告。

## 12. 延期清单（本阶段不实现）

符文升级 / 经验事务、符文套装效果、符文生成与掉落概率、符文合成、符文评分或回收价值。

---

## 13. Git

- **Base**：`b69913c0cb9e4c31434e1e2e3778c95aeede9d3a`（Phase 3.6 实现提交，远端已确认）
- **Phase 3.6.1 实现提交**：`86f7e7a4887ce8ea168703f3f63ccadd204a718f`「Phase 3.6.1: 玩家级 Rune 拓扑属性聚合与装备模拟接入收口 (base b69913c0cb9e4c31434e1e2e3778c95aeede9d3a)」
- **远端分支**：`origin/main`
- **Phase 3.6.2 文档纠正提交**：在 `86f7e7a` 之后的后续提交中完成；具体纠正提交 SHA 以 `git log` 和最终交付消息为准（不通过 amend 追逐"文件包含自身 SHA"，不在本报告中写入自身 SHA）
- 同步状态（`git rev-list --left-right --count HEAD...origin/main` 应为 `0  0`）以最终交付消息为准。
- 按指令**停止等待远端 Review，不进入 Phase 3.7**。

> 注：本报告此前误把某 `git commit --amend` 前的旧 SHA（dangling commit，不在远端提交历史中）当作 Phase 3.6.1 实现 SHA 与"本地=远端"同步点。Phase 3.6.2 已删除该错误 SHA 的所有字面出现，统一以远端实际可见的 `86f7e7a` 为准。
