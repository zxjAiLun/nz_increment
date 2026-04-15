# nz_increment 10 轮迭代开发计划

> 基于 RULES.md、README.md 及源码分析制定。每轮可独立完成并 PR 合并。

---

## 背景与现状摘要

### 违规项（必须修复）
| # | 违规项 | 位置 |
|---|--------|------|
| V1 | App.vue = 1235 行（规则 ≤ 200 行） | src/App.vue |
| V2 | 存在 `console.log`/`console.error`（规则禁止） | 多处 |
| V3 | 使用 `window.setInterval` 作为战斗循环（规则禁止） | App.vue:278,320 |
| V4 | 无 Vitest 测试框架（规则强制要求） | package.json |
| V5 | `utils/constants.ts` 被 RULES.md 引用但不存在 | — |
| V6 | 业务逻辑写在 .vue 内（规则禁止） | App.vue 大量 |

### 数值问题（来自 README + 源码验证）
| # | 问题 | 源码位置 | 严重度 |
|---|------|----------|--------|
| N1 | 怪物防御 = baseValue × 3，README 声称 × 6，实际可能两者都不对 | monsterGenerator.ts:29 | 🔴 高 |
| N2 | 抽奖成本 = 10 × 1.005^difficulty，增长率极缓但缺少上限 | playerStore.ts:379 | 🟡 中 |
| N3 | 真实/虚空伤害占比过高，普通攻击打不动怪 | calc.ts:99-107 | 🔴 高 |
| N4 | 装备等级跟不上难度，无装备等级匹配机制 | equipmentGenerator.ts | 🟡 中 |
| N5 | 技能描述与实际效果不一致（skillSystem.ts） | skillSystem.ts | 🟡 中 |
| N6 | 生命偷取仅来自暴击幸运营运（0.8%/次），实际几乎为 0 | gameStore.ts:261 | 🔴 高 |
| N7 | 速度不影响先手判定（行动槽同时填充，速度优势只给伤害加成） | gameStore.ts:354-358 | 🟡 中 |
| N8 | 伤害数字动画组件已存在但战斗循环中未调用 `addDamagePopup` | App.vue / gameStore.ts | 🟡 中 |
| N9 | 界面信息过密（App.vue 1235 行混杂所有逻辑） | App.vue | 🟡 中 |
| N10 | 装备信息显示不全（无词条列表、套装效果） | RoleTab.vue | 🟡 中 |

---

## 迭代依赖关系图

```
迭代1 ──→ 迭代2 ──→ 迭代3 ──→ 迭代4 ──→ 迭代5 ──→ 迭代6 ──→ 迭代7 ──→ 迭代8 ──→ 迭代9 ──→ 迭代10
 │                                                      │
 └─(constants.ts 新增)─────────────────────────────────┘
```

- 迭代 1（基础设施）：独立，无前置依赖
- 迭代 2（战斗系统）：依赖迭代 1（gameLoop composable、constants.ts）
- 迭代 3（数值平衡）：依赖迭代 2（战斗循环修复后验证数值）
- 迭代 4（技能系统）：依赖迭代 2
- 迭代 5（装备系统）：依赖迭代 3 数值公式稳定
- 迭代 6（被动技能）：依赖迭代 4 技能框架
- 迭代 7（功能扩展 A）：依赖迭代 5
- 迭代 8（功能扩展 B）：无直接依赖
- 迭代 9（测试与数据迁移）：依赖迭代 3、5、7
- 迭代 10（UI 打磨 + 验收）：依赖所有前序迭代

---

## 里程碑总览

| 里程碑 | 包含迭代 | 核心产出 |
|--------|----------|----------|
| M1: 架构重建 | Iter 1 | App.vue ≤ 200L，gameLoop composable，无 console.log |
| M2: 核心游戏循环 | Iter 2-3 | 战斗系统修复，伤害公式验证，数值平衡初版 |
| M3: 系统完善 | Iter 4-6 | 技能修复，被动技能，装备套装 |
| M4: 内容扩展 | Iter 7-8 | 更多玩法系统 |
| M5: 质量保障 | Iter 9 | Vitest 全覆盖，数据迁移 |
| M6: 发布就绪 | Iter 10 | UI 打磨，Release 准备 |

---

## 迭代 1：架构重建与基础设施

**目标**：解决所有结构性违规，建立项目基础设施，为后续迭代铺路。

### 任务列表

#### T1.1 创建 `utils/constants.ts`
- **内容**：所有魔法数字集中管理
  - `CRIT.BASE_RATE = 5`、`CRIT.BASE_DAMAGE = 150`
  - `GAUGE_MAX = 100`
  - `DAMAGE_OVERFLOW_MAX = 1e15`
  - `DEFENSE_DIVISOR = 200`（护甲公式分母）
  - `HIT_MIN_CHANCE = 0.05`、`ACCURACY_MAX = 80`
  - 颜色变量（从 design-system.css 迁移）
- **验收**：所有 stores/utils 中的硬编码常量替换为从 constants 引入

#### T1.2 创建 `composables/useGameLoop.ts`
- **内容**：将 App.vue 中 `window.setInterval` 驱动的战斗循环迁移至此
  - 导出一个 `useGameLoop` composable，暴露 `start() / pause() / stop()`
  - 内部使用 `requestAnimationFrame` + `deltaTime` 累积驱动（替代 `setInterval`）
  - 接收 `gameStore` 作为参数，不直接 import（延迟解析避免循环依赖）
- **验收**：`App.vue` 中 `window.setInterval` 调用全部移除；`useGameLoop` 正确驱动 gameStore 状态更新

#### T1.3 重构 `App.vue`（1235 行 → ≤ 200 行）
- **方案**：按功能域拆分为子组件
  - `BattleArea.vue`：战斗场景（怪物显示、BattleHUD、行动槽）
  - `PlayerStatusBar.vue`：顶部玩家状态条（HP、金币、钻石）
  - `OverlayContainer.vue`（轻量）：DamagePopup、ConfirmDialog 的容器
  - `TabsContainer.vue`：包裹 TabNavigation 和各个 TabContent
  - App.vue 仅剩：布局结构 + store 连接 + 生命周期挂载
- **验收**：`App.vue` ≤ 200 行，单个 .vue ≤ 400 行，TypeScript 严格类型

#### T1.4 清除所有 `console.log`/`console.error`
- **范围**：playerStore.ts、gameStore.ts、rebirthStore.ts、storageManager.ts、App.vue
- **方案**：`console.log` → 移除或替换为 `addBattleLog`（如果是战斗相关）；`console.error` → 替换为错误状态存储，UI 展示
- **验收**：全代码库 `grep -r "console\." src/` 无结果

#### T1.5 创建 `composables/useLogger.ts`（可选，看需求）
- **内容**：生产环境空实现 `useLogger.ts`，导出 `logger.info/warn/error`，生产构建自动替换为 noop
- **验收**：dev 模式 logger 输出，prod 模式静默

#### T1.6 更新 `vite.config.ts` 添加 `defineConfig`
- **内容**：配置 `define['__VUE_OPTIONS_API__', 'false']` 确保无 options API
- **验收**：`vue-tsc --noEmit` 通过，无 options API 警告

### 技术要点
- 拆组件时注意 Pinia store 的 `storeToRefs` 正确使用
- `useGameLoop` 使用 `requestAnimationFrame`，在 visibilitychange 时暂停以省电
- constants.ts 不得 import 任何 Vue/Pinia 内容

### 风险评估
- **高风险**：App.vue 拆分涉及大量状态传递，可能破坏现有功能 → 方案：先写 Vitest 保护（迭代 9 提前或本迭代加），每拆一个组件跑一次 dev 验证
- **中风险**：移除 console.log 后某些调试信息丢失 → 方案：用 `addBattleLog` 替代战斗相关日志，错误状态替代 console.error

---

## 迭代 2：战斗系统核心修复

**目标**：修复速度先手逻辑、生命偷取、伤害弹出集成、战斗循环健壮性。

### 任务列表

#### T2.1 修复速度先手判定
- **当前问题**：`playerActionGauge` 和 `monsterActionGauge` 同时从 0 开始填充，速度只影响填充率，不影响谁先行动
- **修复**：
  - 在 `useGameLoop` 中，初始状态根据 `calculateSpeedAdvantage` 给予较快一方"先手偏移"（初始 gauge 预填充值）
  - 公式：`先手偏移 = (fastSpeed - slowSpeed) * tickRate * 0.5`（最多预填充到 GAUGE_MAX 的 50%）
  - 同时保留伤害加成逻辑（speedRatio ≥ 2 → 伤害 +50%）
- **验收**：
  - 速度比 ≥ 2 时，玩家必定先手攻击（单元测试验证）
  - 速度比 ≥ 2 时，同 tick 内玩家行动两次（单元测试验证）

#### T2.2 修复生命偷取机制
- **当前问题**：lifesteal 仅通过 `luckEffects.critBonus * 10` 计算（基础幸运 10 → 0.8%/次，实际为 0）
- **修复**：
  - 方案 A（推荐）：在 `calc.ts` 中新增 `calculateSkillLifesteal(skill, damage)` 函数，允许技能单独定义吸血率
  - 方案 B：全局 lifesteal 率从幸运剥离，改为独立属性 `lifeStealRate`（通过装备/技能获取）
  - 在 `gameStore.ts` 的 `executePlayerAttack` 中，攻击结算后调用 `calculateLifesteal`，结果累加到 `playerStore.currentHp`
- **验收**：
  - 有吸血技能时，击杀怪物回复生命（模拟验证）
  - 无吸血时，不触发吸血日志

#### T2.3 集成 `addDamagePopup` 到战斗循环
- **当前问题**：`DamagePopup.vue` 已在 App.vue 中导入，但 `gameStore.ts` 中无触发点
- **修复**：
  - 在 `gameStore.ts` 中新增 `damagePopups` ref（或者通过事件 emit）
  - 在 `executePlayerAttack` 和 `executeMonsterAttack` 后调用 `addDamagePopup(type, value)`
  - `type` 包括：'normal'、'crit'、'true'、'void'、'skill'、'heal'、'miss'
  - 坐标：玩家攻击时 x = 50% + random(-20, 20)%，y = 40%；怪物攻击时 x = 50% + random(-20, 20)%，y = 60%
- **验收**：战斗中每次伤害/治疗都有对应弹出动画（手动验证 + Vitest 快照）

#### T2.4 重构战斗循环错误处理
- **当前问题**：`gameStore.ts:387` 有 `console.error('Error in gameLoop:', e)`
- **修复**：
  - 在 `gameStore` 中新增 `error` ref 存储错误状态
  - 战斗循环的 try-catch 设置 `error.value = e`，不向 console 输出
  - UI 层（如 App.vue）订阅 `error`，显示错误提示
- **验收**：战斗循环异常不打印 console，但 UI 显示错误提示

### 技术要点
- 速度先手偏移在首次填充时应用，后续正常累积不受影响
- `addDamagePopup` 的坐标计算应在 BattleArea.vue 中执行（相对战斗区域），避免坐标溢出

### 风险评估
- **中风险**：先手偏移改动可能破坏现有战斗节奏感 → 方案：可配置化，默认关闭（通过 `gameStore.gameSettings.enableSpeedFirstStrike`），用户可选开启

---

## 迭代 3：数值平衡（防御/穿透/暴击/抽奖）

**目标**：修复怪物防御增长曲线、穿透获取途径、暴击收益、抽奖成本。

### 任务列表

#### T3.1 修复怪物防御公式
- **当前问题**：`monsterGenerator.ts:29` = `baseValue × 3`，导致后期防御极高，普通攻击无效
- **修复**：
  - 防御公式改为 `baseValue × 1.5`（前期不过分，后期也有可玩空间）
  - BOSS 防御倍率从 `× 1.2` 调整为 `× 1.5`
  - 在 `constants.ts` 中定义 `MONSTER.DEFENSE_MULTIPLIER = 1.5`、`BOSS_DEFENSE_MULT = 1.5`
- **验收**：
  - 难度值 100 时怪物防御约 351（原 117×3=351，新 117×1.5=176）
  - 玩家 base penetration（来自幸运）可覆盖难度 100 怪物的防御

#### T3.2 调整穿透属性获取
- **当前问题**：穿透仅来自幸运换算 `floor(luck × 0.1)`，无独立获取途径
- **修复**：
  - 升级属性中增加"穿透"购买选项（每点穿透 = 50 金币）
  - 装备词条中增加穿透稀有度
  - 穿透收益公式：`effectiveDef = max(0, monster.def * (1 - penetration%) - flatPenetration)`
- **验收**：
  - 难度 100 怪物防御 176，玩家通过购买+装备可达 100+ 穿透
  - 护甲减伤比例有感下降（护甲公式中的 200 分母仍然有效）

#### T3.3 调整暴击收益曲线
- **当前问题**：critRate 基础 5%，每 100 难度 +1%，上限 50%；critDamage 150%，每 100 难度 +10%
- **修复**：
  - 暴击率成长提高至 `5 + difficulty × 0.02`（每 100 难度 +2%，更明显）
  - 添加"暴击抗性"上限：`CRIT_RATE_MAX = 50`
  - 在 constants.ts 中定义 `CRIT.RATE_GROWTH = 0.02`、`CRIT.DAMAGE_GROWTH = 0.1`
- **验收**：难度 500 时 critRate ≈ 15%，critDamage ≈ 200%

#### T3.4 调整抽奖成本增长曲线
- **当前问题**：`10 × 1.005^difficulty` 增长过缓（difficulty 5000 时单抽约 1.9 万），金币收入也快速增长
- **修复**：
  - 将增长率从 `1.005` 调整为 `1.002`（更平缓）
  - 设置软上限：单抽成本不超过 `玩家金币上限的 10%`（动态 cap）
  - 在 `playerStore.getLotteryCost()` 中引入 `gameStore.difficultyValue`
- **验收**：
  - difficulty 100：单抽 ≈ 16 金币（vs 旧 16 金币，无变化）
  - difficulty 500：单抽 ≈ 31 金币（vs 旧约 33 金币）
  - difficulty 5000：单抽 ≈ 444 金币（vs 旧 19300 金币，大幅改善）

#### T3.5 装备等级匹配机制
- **当前问题**：装备掉落等级固定，导致高难度装备落后
- **修复**：
  - 装备等级 = `Math.max(currentDifficulty - 50, 1)` 起（比当前难度低 50 级内随机）
  - 高难度怪物掉落装备等级上限 = `currentDifficulty`
  - 在 `equipmentGenerator.ts` 中实现 `generateEquipmentForDifficulty(difficulty)`
- **验收**：
  - 难度 500 时，掉落装备等级范围 450-500
  - 装备评分为同期怪物 HP 的 40-50% 水平

#### T3.6 数值溢出保护审计
- **内容**：所有 `Math.floor`、`Math.min`/`Math.max` 操作增加 `DAMAGE_OVERFLOW_MAX = 1e15` 保护
- **验收**：Vitest 测试覆盖所有 calc.ts 函数在大数值输入时不溢出

### 技术要点
- 修改怪物防御会影响存档一致性（已有存档怪物属性会改变），需在迭代 9 数据迁移中处理
- 穿透调整涉及 `calc.ts` 中的 `effectiveDefense` 计算，需同步更新

### 风险评估
- **高风险**：数值平衡改动会影响已存档玩家的体验 → 方案：提供"难度重置"选项，不强制覆盖存档
- **中风险**：降低防御可能导致后期过于简单 → 方案：配合穿透系统联动调整，保持动态平衡

---

## 迭代 4：技能系统全面修复

**目标**：统一技能描述与实现，修复技能 Bug，建立技能注册表。

### 任务列表

#### T4.1 技能描述与实现对齐审计
- **范围**：skillSystem.ts 中所有 24 个技能的 description 字段
- **方法**：逐个对比 `description` 字符串与实际 `damageMultiplier`、`ignoreDefense`、`trueDamage`、`healPercent` 等字段
- **问题示例**（从源码观察）：
  - 描述"造成 1.5 倍伤害，触发 4 次"实际 hitCount=1，multiplier=1.5 → 应改为"造成 6 倍伤害"
  - 描述"恢复 30% 最大生命"实际 healPercent=30 → 一致
  - 描述"恢复 50% 最大生命"实际 healPercent=50 → 一致
  - 描述"造成 3 倍伤害，触发 4 次" → multiplier=3, hitCount=4 → 实际 12 倍伤害，描述需更新
- **修复**：重写所有不一致的 description，使其精确描述实际效果
- **验收**：`skillSystem.ts` 中所有 skill.description 与对应字段完全一致

#### T4.2 技能释放逻辑与 gameStore 解耦
- **当前问题**：gameStore.ts 直接调用技能效果逻辑，skillStore.ts 仅管理解锁
- **修复**：
  - 在 `composables/useSkillExecutor.ts` 中实现统一的 `executeSkill(skill, context)` 函数
  - 暴露：`calculateSkillDamage(skill, stats)`、`applySkillEffect(skill, gameState)`
  - gameStore.ts 调用 `useSkillExecutor` 而非直接写技能逻辑
- **验收**：所有技能（伤害/治疗/增益/减益）通过 `useSkillExecutor` 执行

#### T4.3 修复技能冷却系统
- **内容**：
  - 技能 `currentCooldown` 初始值应为 `cooldown`（0 表示无冷却）
  - 每次行动后减少 1（tick 冷却而非秒冷却，简化实现）
  - 技能释放时检查 `currentCooldown === 0`
- **验收**：连续释放同一技能被正确阻止（cooldown > 0）

#### T4.4 添加技能被动效果支持
- **内容**：
  - 在 `Skill` interface 中新增 `passiveEffect?: PassiveEffect`
  - `PassiveEffect` = `{ trigger: 'onKill'|'onCrit'|'onHit'|'onDamageTaken', effect: StatBonus | 'heal' }`
  - 被动效果在 `gameStore` 的相应事件中触发（不受 cooldown 限制）
- **验收**：至少 3 个技能有被动效果注册（示例：击杀回血、暴击加攻）

### 技术要点
- 技能描述国际化：使用 `{{ multiplier }}x`、`{{ trueDamage }} 真伤` 占位符格式
- `useSkillExecutor` 不得 import Vue/Pinia，仅操作纯数据

### 风险评估
- **中风险**：技能描述改动影响玩家理解 → 方案：改前通过 changelog 通知，改后提供技能说明面板悬浮提示

---

## 迭代 5：装备系统升级

**目标**：装备信息完善、套装效果、装备评分 UI 优化。

### 任务列表

#### T5.1 完善装备详情显示
- **当前问题**：RoleTab.vue 装备信息不全（无词条列表、无评分）
- **修复**：
  - 装备卡片显示：名称、稀有度、等级、装备槽、词条列表（每条属性 + 数值）、装备评分、装备来源
  - 词条 `isPercent` 时显示 `%`，`isPercent=false` 时显示整数值
  - 悬停/点击展开详情弹窗，显示完整词条
- **验收**：打开 RoleTab，点击任意装备，显示完整词条和评分

#### T5.2 装备套装效果
- **内容**：
  - 定义 5 套装备套装（每套 2 件、4 件触发不同效果）
  - 套装效果示例：
    - "勇者套装"（2件：攻击+10%；4件：暴击率+15%）
    - "守护者套装"（2件：防御+10%；4件：减伤+8%）
    - "疾风套装"（2件：速度+10%；4件：先手率+20%）
    - "暴君套装"（2件：暴击伤害+30%；4件：暴击伤害+60%）
    - "虚空套装"（2件：真实伤害+50；4件：虚空伤害+100）
  - 在 `playerStore` 中计算激活的套装效果并应用到 `totalStats`
- **验收**：
  - 穿戴 2 件/4 件同一套装时，Stats 面板显示对应套装名称和激活效果
  - 套装效果正确叠加到 totalStats

#### T5.3 装备对比功能
- **内容**：
  - 背包中长按/右键一件装备，再点击另一件，显示对比视图
  - 差异高亮：绿色=新装备更优，红色=新装备更差
- **验收**：任意两件装备可对比，差异正确显示

#### T5.4 装备自动穿戴推荐
- **内容**：
  - 基于 `isEquipmentBetter` 逻辑，当背包掉落新装备时，自动提示"是否替换当前装备"
  - 过滤掉评分低于当前装备 5% 的物品（避免频繁提示）
- **验收**：新掉落高评分装备时弹出确认框，低评分装备静默回收

### 技术要点
- 套装效果在 `calculateTotalStats` 中应用，在 constants.ts 中定义套装元数据
- 装备评分 `calculateEquipmentScore` 在 `calc.ts` 中，评分展示四舍五入到整数

### 风险评估
- **低风险**：套装效果为纯加成，不影响核心公式
- **中风险**：套装 UI 可能增加 RoleTab.vue 行数 → 方案：提取为 `EquipmentSetBadge.vue` 组件

---

## 迭代 6：被动技能系统

**目标**：实现 Phase 3 规划的被动技能，作为独立于主动技能的新维度。

### 任务列表

#### T6.1 设计被动技能数据模型
- **内容**：
  - 新增 `PassiveSkill` interface（含 id、name、description、effects[]、unlockCondition）
  - effects = `StatBonus[]` 或特殊效果（lifestealOnKill、critStreak、damageReflect）
  - unlockCondition = `number`（对应 difficultyValue 门槛）
  - 被动技能上限：16 个（4×4 网格）
- **验收**：`types/index.ts` 新增 `PassiveSkill` 类型，字段完整

#### T6.2 实现被动技能激活逻辑
- **内容**：
  - `skillStore.ts` 新增 `passiveSkills` ref 和 `unlockPassiveSkill(id)` 方法
  - 被动技能效果在 `calculateTotalStats` 中应用（通过 effect.type 分发到对应 stat）
  - 特殊效果（lifestealOnKill 等）在 `gameStore` 相应事件中处理
- **验收**：
  - 解锁被动技能后，Stats 面板实时更新
  - 重开游戏后被动技能保持解锁状态

#### T6.3 创建 `PassiveSkillsPanel.vue`
- **内容**：
  - 4×4 网格展示所有被动技能槽位
  - 锁定的槽位显示解锁条件（"难度值达到 X 解锁"）
  - 已解锁的显示名称和简要效果
  - 点击已解锁被动显示详情弹窗
- **验收**：面板入口从 SkillsTab 进入，网格正确显示 16 个槽

#### T6.4 首批被动技能内容（8 个）
| ID | 名称 | 效果 | 解锁难度 |
|----|------|------|----------|
| p1 | 铁壁 | 防御 +20% | 100 |
| p2 | 嗜血 | 击杀回复 1% HP | 200 |
| p3 | 连击之心 | combo +50% | 300 |
| p4 | 暴击回蓝 | 暴击后 +5% 伤害（叠加，5 层） | 500 |
| p5 | 金币翻涌 | 金币收益 +30% | 600 |
| p6 | 幸运光环 | 幸运 +100 | 800 |
| p7 | 坚不可摧 | 受击伤害上限：不超过最大 HP 的 15% | 1000 |
| p8 | 虚空亲和 | 虚空伤害 +200，真实伤害 +100 | 1500 |

### 技术要点
- 被动技能效果应用顺序：在 `calculateTotalStats` 最后应用（所有装备/基础属性之后）
- 叠加层数效果使用 `ref<number>` 在 skillStore 中管理

### 风险评估
- **中风险**：被动技能过多可能导致数值膨胀 → 方案：被动技能效果上限设限（单属性加成不超过 200%）

---

## 迭代 7：功能扩展 A（成就系统升级 + 练功房增强）

**目标**：丰富游戏循环，增加可玩内容。

### 任务列表

#### T7.1 成就系统大幅扩展
- **内容**：
  - 从现有 47 行 achievementStore.ts 扩展到完整成就树
  - 新增成就类别：`endless`（无限模式）、`speedKill`（速杀成就）
  - 每个 phase 解锁一组专属成就
  - 成就奖励：钻石、被动技能点、金币加成、专属称号
- **验收**：成就面板展示所有成就，含进度条和已领奖励

#### T7.2 练功房增强
- **内容**：
  - 练功房新增"自动调整"功能：玩家可设置目标金币/经验/装备难度，系统自动推荐最优练功房等级
  - 练功房新增"速刷模式"：消耗钻石加速练功房收益（1 钻石 = 10 分钟收益）
  - 练功房 BOSS 轮次：每 10 轮出现一次 BOSS（高收益）
- **验收**：练功房界面有"自动调整"滑块和"速刷"按钮

#### T7.3 每日/每周挑战
- **内容**：
  - 每日挑战：击杀 100 只怪物、获得 10000 金币等（重置）
  - 每周挑战：累计击杀 5000 怪物、达到难度值 X（周日重置）
  - 奖励：钻石、稀有装备、成就点数
- **验收**：SettingsTab 或独立面板显示每日/每周挑战进度

#### T7.4 签到系统
- **内容**：
  - 每日签到奖励：连续签到天数越高奖励越好（1-7 天循环）
  - 断签重置为第 1 天
  - 奖励：金币、钻石、装备券、经验书
- **验收**：签到面板显示已签天数和明日奖励预览

### 技术要点
- 每日/每周挑战进度存储在 `nz_meta_v1`（与成就分开，避免互相干扰）
- 签到状态使用 `localStorage` 存储（`nz_meta_v1.dailyLogin`）

### 风险评估
- **低风险**：功能扩展不影响核心公式
- **中风险**：新增存储键需在迭代 9 数据迁移中注册

---

## 迭代 8：功能扩展 B（更多玩法）

**目标**：实现 Phase 3 的部分规划内容。

### 任务列表

#### T8.1 月卡/战令系统
- **内容**：
  - 月卡：30 天有效期，每日登录领取 100 钻石 + 金币加成 20%
  - 战令（battle pass）：分免费/付费轨道，完成任务获得经验提升战令等级，解锁奖励
  - 战令奖励：限定装备、称号、背包扩展、被动技能点
- **验收**：SettingsTab 显示月卡剩余天数和战令等级

#### T8.2 收藏品/图鉴系统
- **内容**：
  - 记录已击杀怪物种类、已获得装备种类
  - 图鉴分页：怪物图鉴（按 phase）、装备图鉴（按稀有度）
  - 图鉴完成度奖励：累计完成 10%/25%/50%/75%/100% 时解锁奖励
- **验收**：独立"图鉴"Tab 显示已发现/未发现条目

#### T8.3 好友/排行榜（本地）
- **内容**：
  - 本地排行榜：按难度值、金币、总击杀数排序
  - 支持手动输入玩家名称存档自己的记录
  - 无需后端，数据存储在 `nz_meta_v1`
- **验收**：排行榜 Tab 显示前 10 名记录

#### T8.4 事件/节日活动框架
- **内容**：
  - 建立 `EVENTS` 常量配置（eventId、startDate、endDate、multipliers、specialRewards）
  - 事件期间内：金币收益 ×2、装备掉落率 +50%、特殊怪物刷新
  - 事件配置文件支持手动启用（用于调试）
- **验收**：事件期间顶部 Banner 显示活动名称，活动结束后自动关闭

### 技术要点
- 所有数据存本地，事件配置为纯数据（无服务端）
- 月卡/战令有效期计算使用 `Date.now()` 差值，不依赖服务端时间

### 风险评估
- **低风险**：全部本地数据，无外部依赖

---

## 迭代 9：测试体系 + 数据迁移

**目标**：满足 RULES.md 强制要求，建立完整测试覆盖，处理破坏性变更的数据迁移。

### 任务列表

#### T9.1 引入 Vitest 测试框架
- **内容**：
  - `npm install -D vitest @vue/test-utils happy-dom`
  - `vite.config.ts` 添加 Vitest 配置
  - `package.json` 添加 `"test": "vitest"`、`"coverage": "vitest coverage"`
  - 根目录 `vitest.config.ts`
- **验收**：`npm run test` 执行通过，零测试（0 tests）也可通过（框架就绪）

#### T9.2 伤害公式全覆盖测试
- **内容**：新建 `src/utils/__tests__/calc.test.ts`
- **用例**（每个 mock Math.random 保证确定性）：
  1. `calculatePlayerDamage` 命中未命中（hitChance < 5% 返回 0）
  2. `calculatePlayerDamage` 暴击触发（critChance 范围内）
  3. `calculatePlayerDamage` 护甲减免（def 200 时约 50% 减免）
  4. `calculatePlayerDamage` 护甲穿透（penetration 抵消 def）
  5. `calculatePlayerDamage` 真实伤害（ignoreDefense=true）
  6. `calculatePlayerDamage` 虚空伤害（不暴击、不受护甲影响）
  7. `calculatePlayerDamage` 溢出保护（输入 1e16 伤害不崩溃）
  8. `calculateMonsterDamage` 完整链
  9. `calculateLifesteal` 正确计算
  10. `calculateEquipmentScore` 评分一致性
  11. `isEquipmentBetter` 阈值判断
  12. `calculateOfflineReward` 时间倍率
- **验收**：12 个测试全部通过，`npm run coverage` 显示 calc.ts 覆盖 100%

#### T9.3 装备系统测试
- **内容**：新建 `src/utils/__tests__/equipmentGenerator.test.ts`
- **用例**：
  1. `generateEquipment` 掉落等级在难度范围内
  2. 装备词条数量与稀有度匹配（ancient/eternal 至少 4 条）
  3. `generateEquipmentForDifficulty` 正确覆盖难度
- **验收**：3 个测试通过

#### T9.4 怪物生成测试
- **内容**：新建 `src/utils/__tests__/monsterGenerator.test.ts`
- **用例**：
  1. 防御值符合公式 `baseValue × MONSTER.DEFENSE_MULTIPLIER`
  2. BOSS 属性为普通怪物 ×1.5（HP）/ ×1.5（攻击）/ ×1.5（防御）
  3. 难度 0 时 baseValue = 10
- **验收**：3 个测试通过

#### T9.5 数据迁移框架
- **内容**：
  - 在 `storageManager.ts` 中实现 `migrateSave(fromVersion, toVersion, data)` 函数
  - 当前存档版本升至 `nz_player_v2` / `nz_game_v2`（数值平衡改动需破坏性更新）
  - 迁移函数处理：旧存档怪物防御重算、装备等级重匹配
- **迁移脚本**：
  ```typescript
  // nz_player_v1 → nz_player_v2
  // 1. 重新计算装备评分（装备等级重匹配）
  // 2. 重置穿透获取（改由独立途径，不再仅从幸运换算）
  ```
- **验收**：旧格式存档可正确迁移到新版本，新存档不受影响

#### T9.6 持续集成配置
- **内容**：
  - GitHub Actions CI：push 时执行 `npm run build` + `npm run test`
  - `vue-tsc --noEmit` 作为类型检查门禁
- **验收**：CI 通过，`main` 分支永远可构建

### 技术要点
- 每个测试 mock `Math.random` 使用 `vi.spyOn(Math, 'random').mockReturnValue(0.5)`
- 溢出测试使用 `1e15`、`1e16`、`Infinity` 等边界值

### 风险评估
- **高风险**：数据迁移一旦有 bug 会破坏玩家存档 → 方案：迁移函数先在测试环境验证，且迁移前自动备份存档

---

## 迭代 10：UI/UX 全面打磨 + 发布就绪

**目标**：解决所有 UI 问题，完成发布前最后优化。

### 任务列表

#### T10.1 界面信息密度优化
- **当前问题**：BattleTab 和 RoleTab 信息过密，重要数据不突出
- **修复**：
  - BattleTab：分离"战斗数值"和"战斗统计"面板，关键数值（玩家攻击/防御/HP）突出显示
  - RoleTab：装备列表改为卡片网格，点击展开详情，避免平铺所有数据
  - 顶部状态栏：精简为"HP 条 + 金币 + 钻石"，详细数据移至 Stats 面板
  - 所有数字使用 `formatNumber` 统一格式化（1,000,000 → 100.0 万）
- **验收**：单屏内关键信息不超过 20 项数值，避免视觉疲劳

#### T10.2 伤害数字动画优化
- **当前问题**：`DamagePopup.vue` 已集成但动画效果可能不佳
- **修复**：
  - 暴击时数字放大 1.5 倍 + 震动 + 闪光（已有 CSS，验证生效）
  - 普通伤害浮动上升 + 淡出（已有，验证生效）
  - 真实/虚空伤害使用特殊颜色（金色/紫色）高亮
  - 连续伤害时数字错开（x 坐标随机偏移避免重叠）
  - 伤害数字在战斗区域顶部，不超出视口
- **验收**：战斗时能清楚区分普通/暴击/真实/虚空/治疗数字

#### T10.3 装备详情完整显示
- **当前问题**：装备只显示属性类型，无词条数值和来源
- **修复**：
  - 装备弹窗显示：名称（稀有度颜色）、等级、装备槽、词条列表（含是否主要属性标记）
  - 词条显示格式：`攻击 +150 (主要)` 或 `防御 +8%`
  - 装备来源：击杀怪物名称/练功房等级
  - 装备对比入口：从详情弹窗发起
- **验收**：任意装备点击展开后，词条完整且格式统一

#### T10.4 设置面板完善
- **当前问题**：SettingsTab 功能单一
- **修复**：
  - 添加"游戏速度"滑块（0.5x - 16x）
  - 添加"伤害数字开关"
  - 添加"音效/音乐开关"（预留音效系统接口）
  - 添加"重置进度"（二次确认，保留月卡）
  - 添加"导出/导入存档"功能
  - 添加"关于"页面（版本号、鸣谢）
- **验收**：设置面板功能完整，无死链接

#### T10.5 响应式布局优化
- **内容**：
  - 移动端适配（最小宽度 375px）：Tab 栏固定底部，战斗区域自适应
  - BattleHUD 在移动端简化为仅显示 HP 条
  - 装备网格在移动端每行显示 2 个（而非 4 个）
- **验收**：iPhone SE（375px）下游戏可正常游玩

#### T10.6 发布检查清单
- [ ] `npm run build` 零警告零错误
- [ ] `npm run typecheck` 零错误
- [ ] `npm run test` 全部通过
- [ ] App.vue ≤ 200 行，所有 .vue ≤ 400 行
- [ ] 全代码库无 `console.log`/`console.error`
- [ ] 存档版本正确，迁移函数测试通过
- [ ] CHANGELOG.md 更新
- [ ] GitHub Release 准备

### 技术要点
- UI 打磨无需改动核心逻辑，可以放心重构
- 响应式布局使用 CSS `@media (max-width: 480px)`，不引入 UI 框架

### 风险评估
- **低风险**：纯 UI 改动，不影响游戏逻辑
- **中风险**：移动端适配可能暴露之前忽略的布局问题 → 方案：提前在浏览器 DevTools 手机模拟器中验证

---

## V4：完整内容填充（迭代 31-40）

> 背景：V3（迭代 21-30）完成了核心战斗机制（ATB速度系统、技能协同），V4 目标是填充所有主要玩法系统，使游戏具备完整可玩性。

### 迭代 31：符文系统
- **内容**：9种符文（攻击/防御/生命/暴击/速度/闪避/韧性/生命偷取/幸运），4种颜色套装，装备宝石槽，嵌入/拆卸，符文仓库，符文属性加成，套装效果
- **验收**：符文系统完整，套装效果正确叠加/激活

### 迭代 32：师徒系统
- **内容**：导师/学徒关系，教学任务，任务完成进度，毕业机制，MasterTab UI
- **验收**：师徒关系正常创建，教学任务正常推进，学徒可毕业

### 迭代 33：排行榜
- **内容**：模拟全球排名，赛季奖励，LeaderboardTab UI
- **验收**：排行榜展示正常，赛季切换时数据重置

### 迭代 34：每日签到
- **内容**：7天循环奖励，连续签到追踪，SigninTab UI
- **验收**：签到日历正确显示，奖励正确发放

### 迭代 35：称号系统
- **内容**：8种称号（初出茅庐/小有名气/崭露头角/声名鹊起/如日中天/登峰造极/超凡入圣/传说），装备/卸下称号，称号效果，TitleTab UI
- **验收**：称号正确装备后属性加成生效

### 迭代 36：Boss Rush
- **内容**：5个Boss，各有独特机制，分数排名，计时器，BossRushTab UI
- **验收**：击败Boss后分数正确计算，排行榜正常

### 迭代 37：套装突破
- **内容**：5套装备×3个突破等级，突破材料，属性倍数加成
- **验收**：突破后装备属性正确提升，材料消耗正确

### 迭代 38：技能皮肤
- **内容**：6款技能皮肤，解锁/穿戴，SkillSkinTab UI
- **验收**：技能皮肤正确应用，显示效果区分

### 迭代 39：最终整合
- **内容**：所有Tab注册，所有Store完整，TypeScript零错误，258测试通过
- **验收**：全系统端到端联调无报错

### 迭代 40：灰度发布验证
- **内容**：TypeScript最终检查，258测试验证，灰度发布候选提交
- **验收**：所有检查通过，灰度分支推送成功

---

## V5：完整可玩版（迭代 41-50）

> 背景：V4（迭代 31-40）填充了所有主要玩法系统，V5 目标是完善成长体系与社交系统，使游戏达到完整可玩状态。

### 迭代 41：连续挑战奖励（Streak系统）
- **内容**：连续挑战奖励，连击乘数，StreakTab UI
- **验收**：连续挑战天数正确累计，奖励正确发放

### 迭代 42：装备回收
- **内容**：装备分解为材料，合成系统，RecycleTab UI
- **验收**：分解后获得正确材料，合成消耗正确

### 迭代 43：随机事件
- **内容**：宝箱/商人/陷阱/祝福事件，加权抽取，EventModal UI
- **验收**：事件触发正确，奖励/惩罚正确执行

### 迭代 44：赛季主题内容
- **内容**：赛季主题，专属奖励，赛季积分，SeasonTab UI
- **验收**：赛季主题正确应用，积分正确累计

### 迭代 45：国际化框架
- **内容**：中英文语言包，语言切换器，完整翻译
- **验收**：语言切换无错误，所有UI文本正确翻译

### 迭代 46：战斗速度控制
- **内容**：1x/2x/4x速度，自动模式，跳过券，BattleSpeedControl UI
- **验收**：速度切换正常，自动战斗正常，跳过消耗正确

### 迭代 47：玩家资料卡
- **内容**：属性展示，成就预览，ProfileCard UI
- **验收**：资料卡显示正确，成就预览正常

### 迭代 48：好友系统
- **内容**：好友列表，黑名单，好友Tab UI，添加/移除/拉黑
- **验收**：好友关系正常创建，社交功能完整

### 迭代 49：新手指引
- **内容**：高亮引导，步骤说明，跳过/下一步，首次奖励
- **验收**：指引流程正确，首次奖励正确发放

### 迭代 50：V5 最终发布
- **内容**：全系统端到端测试，版本号更新至 1.5.0，Release Notes，258测试全部通过，TypeScript零错误
- **验收**：最终 commit 推送成功，版本 1.5.0 发布

---

## 附录

### 附录 A：每轮迭代验收清单模板

```markdown
## 迭代 X 验收清单

### 功能验收
- [ ] T.X.1: ...
- [ ] T.X.2: ...

### 质量门禁
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npm run test` 全部通过（如已引入 Vitest）
- [ ] App.vue 行数 ≤ 200
- [ ] 无 console.log/console.error
- [ ] 单个 .vue 文件 ≤ 400 行

### 数据迁移（如有破坏性变更）
- [ ] 迁移函数实现并测试
- [ ] 存档版本号已更新
```

### 附录 B：关键文件变更汇总

| 文件 | 涉及迭代 | 变更类型 |
|------|----------|----------|
| src/App.vue | 1, 10 | 重构（拆分组件）|
| src/utils/constants.ts | 1, 3 | 新建 |
| src/composables/useGameLoop.ts | 1, 2 | 新建 |
| src/utils/calc.ts | 3, 9 | 修改（防御/溢出）|
| src/utils/monsterGenerator.ts | 3, 9 | 修改（防御公式）|
| src/stores/playerStore.ts | 1, 3 | 修改（lottery cost）|
| src/stores/gameStore.ts | 1, 2, 3 | 修改（生命偷取/伤害弹出）|
| src/utils/skillSystem.ts | 4 | 修改（描述对齐）|
| src/composables/useSkillExecutor.ts | 4 | 新建 |
| src/components/（多个）| 1, 5, 6, 10 | 新建/修改 |
| src/utils/__tests__/ | 9 | 新建目录 |
| vitest.config.ts | 9 | 新建 |

### 附录 C：优先级说明

**P0（阻塞发布）**：迭代 1（架构）+ 迭代 2（战斗）+ 迭代 3（数值）
**P1（严重影响体验）**：迭代 4（技能）+ 迭代 9（测试/数据迁移）
**P2（影响可玩性）**：迭代 5（装备）+ 迭代 6（被动技能）
**P3（内容丰富）**：迭代 7（功能扩展 A）+ 迭代 8（功能扩展 B）
**P4（锦上添花）**：迭代 10（UI 打磨）

建议执行顺序严格按迭代编号，紧急情况可跳过 P3/P4 先发布核心版本。
