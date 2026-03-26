# 棒棒糖大冒险 - 技术重构与代码质量改进 Spec

## Why

当前项目"棒棒糖大冒险"存在多个严重的技术债务问题：
- `App.vue` 文件臃肿（2600+ 行），违反单一职责原则
- 核心战斗逻辑重复且不一致（暴击判定）
- 关键游戏机制未完整实现（速度优势双行动）
- 代码组织混乱，业务逻辑与展示逻辑混合

如果不进行系统性重构，将严重影响后续开发和维护效率。

## What Changes

### P0 紧急重构（必须立即处理）

#### 1. App.vue 拆分重构
- 将 2600+ 行的 `App.vue` 拆分为多个独立组件
- 目标：单个组件不超过 400 行
- 提取 Tab 导航、战斗 HUD、商店、设置等为独立组件
- 创建 `composables/` 目录存放业务逻辑

#### 2. 暴击系统统一
- 抽取重复的暴击判定逻辑到 `calc.ts`
- 创建统一的 `calculateCrit` 函数
- 修复 `critResist` 在玩家/怪物端的不对称问题
- 定义 `CRIT_CONSTANTS` 常量集合

#### 3. 速度优势系统完善
- 在 `gameLoop` 中实现 `hasExtraTurn` 逻辑
- 确保速度 ≥2 倍时触发双行动
- 双行动时应用 10% 伤害加成

### P1 重要重构（高优先级）

#### 4. BUFF 系统重构
- 重构 BUFF 数据结构，关联到具体 Skill
- 修复 `getBuffOriginalDuration` 从技能列表反查的逻辑
- 支持同名 BUFF 叠加而非覆盖

#### 5. Combo 系统接入
- 将 `getPlayerHitCount` 接入战斗流程
- 实现连击伤害分配逻辑
- 添加连击计数器 UI 反馈

#### 6. 数值平衡修复
- 调整怪物防御增长公式（当前 `baseValue × 6` 过快）
- 修复抽奖成本指数爆炸问题（`1.005^x`）
- 重新评估真实/虚空伤害占比

### P2 中等优先级

#### 7. accuracy 属性修正
- 按规范修正命中公式
- `hitChance = Math.min(0.95, 0.8 + attacker.accuracy)`

#### 8. doLottery 递归改循环
- 将递归改为循环，避免栈溢出风险

#### 9. 伤害飘字系统接入
- 将 DamagePopup.vue 接入战斗流程
- 确保所有伤害类型都有飘字反馈

#### 10. 存档版本迁移机制
- 实现 `migrateSaveData` 函数
- 支持 V1 → V2 数据迁移

### P3 低优先级

#### 11. 离线奖励公式修正
- 修正 `calculateOfflineReward` 中的 `monster.attack` 问题

## Impact

### 受影响的文件

| 文件 | 当前行数 | 目标行数 | 变更类型 |
|------|---------|---------|---------|
| App.vue | 2600+ | ≤200 | 重构 |
| calc.ts | 258 | 350+ | 新增函数 |
| gameStore.ts | 423 | 500+ | 完善逻辑 |
| playerStore.ts | 594 | 600+ | BUFF重构 |
| types/index.ts | 300 | 350+ | 新增类型 |

### 新增目录结构

```
src/
├── components/          # UI 组件（扩展）
│   ├── Battle/          # 战斗相关组件
│   ├── Player/          # 玩家相关组件
│   ├── Shop/            # 商店组件
│   └── Common/          # 通用组件
├── composables/         # 组合式函数（新增）
│   ├── useBattle.ts     # 战斗流程逻辑
│   ├── useEquipment.ts  # 装备逻辑
│   └── useOffline.ts    # 离线收益
└── utils/
    └── constants.ts     # 常量统一管理（新增）
```

### 风险评估

| 重构项 | 风险等级 | 缓解措施 |
|--------|---------|---------|
| App.vue 拆分 | 高 | 分阶段实施，充分测试 |
| 暴击系统统一 | 中 | 保留原函数别名，确保向后兼容 |
| 速度优势实现 | 低 | 有现有的 `calculateSpeedAdvantage` 基础 |

## 新增需求

### Requirement: 暴击常量统一管理

系统 SHALL 提供统一的暴击相关常量管理。

#### Scenario: 暴击计算使用统一常量
- **WHEN** 计算暴击时
- **THEN** 使用 `CRIT_CONSTANTS` 中的常量值
- **AND** 暴击率上限为 50%，最低暴击倍率为 1.2

### Requirement: 速度优势双行动

系统 SHALL 在玩家速度 ≥2 倍怪物速度时执行双行动。

#### Scenario: 双行动触发
- **WHEN** 玩家速度 / 怪物速度 ≥ 2
- **THEN** 在同一 tick 内执行两次玩家攻击
- **AND** 第二次攻击伤害增加 10%

### Requirement: 组件行数限制

系统 SHALL 确保 `App.vue` 不超过 200 行。

#### Scenario: 组件拆分验证
- **WHEN** 提交代码时
- **THEN** 验证 App.vue 行数 ≤ 200
- **AND** 单个 .vue 文件 ≤ 400 行

## 修改需求

### Requirement: App.vue 职责精简

**修改前**: App.vue 包含所有 Tab 渲染、战斗 HUD、确认对话框、商店逻辑
**修改后**: App.vue 仅做布局和 Tab 路由，业务逻辑移至 composables

### Requirement: 暴击判定逻辑统一

**修改前**: `calculatePlayerDamage` 和 `calculateMonsterDamage` 有各自独立的暴击判定
**修改后**: 统一使用 `calculateCrit` 函数，共享相同的暴击计算逻辑

### Requirement: 行动槽系统完善

**修改前**: `hasExtraTurn: true` 但 `gameLoop` 不执行双行动
**修改后**: `gameLoop` 在检测到 `hasExtraTurn` 时立即执行第二次攻击

## 移除需求

### Requirement: 递归 doLottery

**移除原因**: 递归调用可能导致栈溢出
**迁移方案**: 改为 while 循环实现

## 技术规范遵循

本重构计划严格遵循 `nz_increment_rules.md` 中定义的规范：

1. **2.1 项目结构规范**: 引入 composables 目录，拆分 App.vue
2. **2.2 组件规范**: Props 带类型和注释，emit 使用函数形式
3. **2.3 状态管理规范**: 使用 storeToRefs，避免跨 Store 直接修改
4. **2.4 数值计算规范**: 统一伤害公式顺序，提取暴击常量
5. **2.5 战斗流程规范**: 完善速度优势双行动逻辑
6. **2.8 数据持久化规范**: 实现存档版本迁移机制

## 开发要求

### 实施阶段必须使用 frontend-dev skill

根据用户要求，在执行本规范中的所有任务时，**必须**使用 `/frontend-dev` skill 进行开发。该 skill 提供了：

- Premium UI design principles（高级 UI 设计原则）
- Cinematic animations（电影级动画效果）
- Real media assets integration（真实媒体资源整合）
- Conversion-optimized copywriting（转化优化文案）

### UI 组件开发标准

所有新建和重构的 Vue 组件必须满足：

1. **视觉设计**
   - 使用渐变背景而非纯色
   - 添加阴影和圆角提升层次感
   - 统一的颜色系统（遵循 RARITY_COLORS 等常量）

2. **动画效果**
   - 组件进入/退出动画
   - 状态变化过渡动画
   - 交互反馈动画（hover、active）

3. **响应式设计**
   - 移动端适配
   - 合理的触摸目标大小

4. **可访问性**
   - 语义化 HTML
   - ARIA 属性
   - 键盘导航支持

---

## 项目进度

### 已完成 ✅

#### P0 紧急重构
- ✅ **暴击系统统一** (任务 2)
  - 添加了 `CRIT_CONSTANTS` 常量集合
  - 创建了 `calculateCrit` 统一函数
  - 重构了 `calculatePlayerDamage` 和 `calculateMonsterDamage`
  - 修复了 `critResist` 不对称问题

- ✅ **速度优势双行动实现** (任务 3)
  - 分析了 `calculateSpeedAdvantage` 函数
  - 在 `processPlayerAttack` 中实现了双行动逻辑
  - 添加了视觉反馈 "⚡ 双倍行动!"

#### TypeScript 类型错误修复 ✅
- 修复了 **42 个** TypeScript 类型错误
- 修复的错误包括：
  - gameStore.ts 缺失属性（battleActive, pauseBattle, skillEffects 等）
  - playerStore.ts 中 .value 的错误使用
  - achievementChecker.ts 中的类型不匹配
  - 所有未使用的变量和导入
  - storageManager.ts 中的属性重复定义问题
  - RoleTab.vue 中 EquipmentSlot 类型不匹配

### 进行中 🚧

#### P0 App.vue 拆分重构 (任务 1) ✅
- **已完成**：App.vue 从 **1737 行减少到 138 行**（减少 92%）
- **新增组件**：DebugPanel, RebirthModal, KeyboardShortcuts
- **新增 composables**：useBattle, useKeyboard, useGameLoop
- **架构优化**：使用 composables 封装业务逻辑，符合规范要求

### 待处理 📋

#### P1 重要重构
- BUFF 系统重构 (任务 4)
- Combo 系统接入 (任务 5)
- 数值平衡修复 (任务 6)

#### P2 中等优先级
- accuracy 属性修正 (任务 7)
- doLottery 递归改循环 (任务 8)
- 伤害飘字系统接入 (任务 9)
- 存档版本迁移机制 (任务 10)

#### P3 低优先级
- 离线奖励公式修正 (任务 11)

### 质量指标

| 指标 | 状态 | 说明 |
|------|------|------|
| TypeScript 类型检查 | ✅ 通过 | 0 错误 |
| App.vue 行数 | ✅ 完成 | **138 行**（目标 ≤200 行）|
| 组件拆分 | ✅ 完成 | DebugPanel, RebirthModal, KeyboardShortcuts |
| Composables | ✅ 完成 | useBattle, useKeyboard, useGameLoop |
| 暴击系统统一 | ✅ 完成 | 所有伤害计算使用统一函数 |
| 速度优势双行动 | ✅ 完成 | 已实现并测试 |
