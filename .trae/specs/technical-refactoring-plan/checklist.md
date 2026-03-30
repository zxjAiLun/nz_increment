# 检查清单 - 技术重构与代码质量改进

> **开发要求**: 所有 UI 组件开发必须使用 `/frontend-dev` skill，遵循高级 UI 设计标准

## P0 紧急重构

### 任务 1: App.vue 拆分重构 ✅

- [x] 目录结构创建 ✅
  - [x] `src/components/Battle/` 目录存在
  - [x] `src/components/Player/` 目录存在
  - [x] `src/components/Shop/` 目录存在
  - [x] `src/components/Common/` 目录存在
  - [x] `src/composables/` 目录存在

- [x] TabNavigation 组件 ✅
  - [x] TabNavigation.vue 文件存在
  - [x] Props 类型定义完整
  - [x] Tab 切换逻辑正常工作
  - [x] Tab 切换动画已实现
  - [x] 从 App.vue 已移除相关代码

- [x] BattleHUD 组件 ✅
  - [x] BattleHUD.vue 文件存在
  - [x] 玩家/怪物血条显示正确
  - [x] 行动槽填充逻辑正确
  - [x] 技能按钮可点击
  - [x] 从 App.vue 已移除相关代码

- [x] PlayerPanel 组件 ✅
  - [x] PlayerPanel.vue 文件存在
  - [x] 属性显示完整（基础/进阶/高级/终极）
  - [x] 装备栏显示正确
  - [x] 技能学习界面正常
  - [x] 从 App.vue 已移除相关代码

- [x] ShopTab 组件 ✅
  - [x] ShopTab.vue 文件存在
  - [x] 属性购买功能正常
  - [x] 技能学习功能正常
  - [x] 装备抽卡功能正常
  - [x] 从 App.vue 已移除相关代码

- [x] SettingsTab 组件 ✅
  - [x] SettingsTab.vue 文件存在
  - [x] 音效设置有效
  - [x] 游戏速度设置有效
  - [x] 其他设置项正常工作
  - [x] 从 App.vue 已移除相关代码

- [x] Composables 组合式函数 ✅
  - [x] `useBattle.ts` 存在且导出正确
  - [x] `useKeyboard.ts` 存在且导出正确
  - [x] `useGameLoop.ts` 存在且导出正确
  - [x] 所有函数无 Vue/Pinia 依赖（纯工具）

- [x] 新增组件 ✅
  - [x] `DebugPanel.vue` 调试面板组件
  - [x] `RebirthModal.vue` 转生模态框组件
  - [x] `KeyboardShortcuts.vue` 快捷键提示组件

- [x] App.vue 精简 ✅
  - [x] App.vue 行数 **138 行**（目标 ≤200 行）
  - [x] 仅包含布局和 Tab 路由逻辑
  - [x] 无业务逻辑代码残留
  - [x] 导入所有新组件
  - [x] TypeScript 类型检查通过

### 任务 2: 暴击系统统一 ✅

- [x] CRIT_CONSTANTS 定义 ✅
  - [x] calc.ts 包含 CRIT_CONSTANTS
  - [x] BASE_CRIT_RATE = 5
  - [x] BASE_CRIT_DAMAGE = 150
  - [x] MIN_CRIT_MULT = 1.2
  - [x] MAX_CRIT_RATE = 50
  - [x] CRIT_RESIST_FACTOR = 0.5
  - [x] CRIT_DMG_RESIST_FACTOR = 0.2

- [x] calculateCrit 函数 ✅
  - [x] 函数签名正确
  - [x] 返回类型包含 isCrit, critMultiplier, effectiveCritRate
  - [x] 暴击率计算正确（考虑 CRIT_RESIST_FACTOR）
  - [x] 暴击伤害计算正确（考虑 CRIT_DMG_RESIST_FACTOR）
  - [x] 被四处调用（玩家/怪物 × 攻击/受击）

- [x] calculatePlayerDamage 重构 ✅
  - [x] 使用 calculateCrit 函数
  - [x] 暴击逻辑与怪物端对称
  - [x] critResist 正确引用

- [x] calculateMonsterDamage 重构 ✅
  - [x] 使用 calculateCrit 函数
  - [x] 暴击逻辑与玩家端对称
  - [x] critResist 正确引用

### 任务 3: 速度优势双行动实现 ✅

- [x] calculateSpeedAdvantage 分析 ✅
  - [x] 函数返回 hasExtraTurn 字段
  - [x] 函数返回 extraTurnDamageBonus 字段
  - [x] 速度比 ≥2 时 hasExtraTurn = true
  - [x] 速度比 ≥1.5 且 <2 时 extraTurnDamageBonus = 0

- [x] gameLoop 修改 ✅
  - [x] 玩家回合后检查 hasExtraTurn
  - [x] hasExtraTurn=true 时执行第二次攻击
  - [x] 第二次攻击应用 10% 伤害加成
  - [x] 行动槽仅消耗一次

- [x] 视觉反馈 ✅
  - [x] 显示"⚡ 双倍行动!"提示
  - [x] 第二次攻击有特殊标记
  - [x] 战斗日志记录双行动

---

## P1 重要重构

### 任务 4: BUFF 系统重构

- [ ] 当前 BUFF 分析
  - [ ] activeBuffs 的 Map 结构已确认
  - [ ] BUFF 与 Skill 的关联方式已确认

- [ ] ActiveBuff 接口
  - [ ] 包含 skillId 字段
  - [ ] 包含 statType 字段
  - [ ] 包含 value 字段
  - [ ] 包含 startTime 字段
  - [ ] 包含 duration 字段
  - [ ] 包含 stacks 字段

- [ ] applyBuff 函数修改
  - [ ] 支持同名 BUFF 叠加
  - [ ] stacks 正确增加
  - [ ] skillId 正确存储

- [ ] getBuffOriginalDuration 修复
  - [ ] 从 buff.skillId 直接查找
  - [ ] 不再从技能列表反查

### 任务 5: Combo 系统接入

- [ ] getPlayerHitCount 分析
  - [ ] combo 值计算方式已确认
  - [ ] 返回值意义已确认

- [ ] 伤害计算接入
  - [ ] calculatePlayerDamage 调用 getPlayerHitCount
  - [ ] 连击次数正确
  - [ ] 伤害均分逻辑正确

- [ ] UI 反馈
  - [ ] BattleHUD 显示连击计数器
  - [ ] "连击 x2!" 等提示正常显示
  - [ ] 连击计数在攻击后正确重置

### 任务 6: 数值平衡修复

- [ ] 怪物防御分析
  - [ ] monsterGenerator.ts 防御计算已定位
  - [ ] baseValue × 6 的影响已确认

- [ ] 防御增长调整
  - [ ] 调整为 baseValue × 4 或引入衰减系数
  - [ ] 不同难度下的防御值已验证

- [ ] 抽奖成本分析
  - [ ] doLottery 成本计算已定位
  - [ ] 1.005^x 的增长速度已确认

- [ ] 成本修复
  - [ ] 调整为 1.003 或 1.002 或设置上限
  - [ ] 成本增长速度合理

---

## P2 中等优先级

### 任务 7: accuracy 属性修正

- [ ] 命中公式分析
  - [ ] calc.ts 中的 hitChance 计算已确认
  - [ ] accuracy 和 dodge 的使用方式已确认

- [ ] 公式修正
  - [ ] 已改为 `hitChance = Math.min(0.95, 0.8 + attacker.accuracy - defender.dodge * 0.5)`
  - [ ] 命中判定逻辑测试通过

### 任务 8: doLottery 递归改循环

- [ ] 递归分析
  - [ ] doLottery 递归实现已确认
  - [ ] 递归调用点已定位

- [ ] 循环改写
  - [ ] 递归已替换为 while 循环
  - [ ] 逻辑与原实现一致
  - [ ] 功能测试通过

### 任务 9: 伤害飘字系统接入

- [ ] DamagePopup.vue 分析
  - [ ] 组件接口定义已确认
  - [ ] 动画效果实现已确认

- [ ] 战斗流程集成
  - [ ] calculatePlayerDamage 返回 DamageResult
  - [ ] 组件监听伤害事件
  - [ ] 飘字正确显示

- [ ] 伤害类型支持
  - [ ] 普通伤害: 青色显示
  - [ ] 暴击: 红色 + 放大效果
  - [ ] 真实伤害: 金色显示
  - [ ] 虚空伤害: 橙色显示

### 任务 10: 存档版本迁移机制

- [ ] 类型定义
  - [ ] SaveDataV1 类型定义正确
  - [ ] SaveDataV2 类型定义正确

- [ ] migrateSaveData 实现
  - [ ] 版本号检测正确
  - [ ] V1 → V2 迁移逻辑正确
  - [ ] 迁移后 version = 2

- [ ] 存档加载集成
  - [ ] 初始化时调用 migrateSaveData
  - [ ] 迁移后数据完整性验证

---

## P3 低优先级

### 任务 11: 离线奖励公式修正

- [ ] calculateOfflineReward 分析
  - [ ] monster.attack 使用位置已定位
  - [ ] 应为 player.stats.attack 已确认

- [ ] 公式修正
  - [ ] 已替换为正确的属性
  - [ ] 计算结果合理

---

## 整体验收

- [ ] App.vue 行数 ≤ 200 行
- [ ] 单个 .vue 文件 ≤ 400 行
- [x] 所有 TypeScript 类型检查通过 ✅
  - [x] 运行 `npx vue-tsc --noEmit` 无错误
- [x] 暴击计算使用统一函数和常量 ✅
- [x] 速度优势双行动正常工作 ✅
- [ ] BUFF 系统支持叠加
- [ ] 连击系统正确计算伤害分配
- [ ] 存档迁移机制正常工作
- [ ] 所有功能测试通过
  - [ ] 战斗流程正常
  - [ ] 商店功能正常
  - [ ] 存档保存/加载正常

---

## UI 设计标准验收（frontend-dev skill）

所有新建和重构的组件必须满足以下标准：

### 视觉设计
- [ ] 使用渐变背景而非纯色
- [ ] 包含适当的阴影效果
- [ ] 圆角使用统一（推荐 8px-16px）
- [ ] 颜色系统与现有设计一致

### 动画效果
- [ ] 组件进入/退出动画
- [ ] 状态变化过渡动画
- [ ] 交互反馈动画（hover、active）
- [ ] 动画流畅（60fps）

### 代码质量
- [ ] 使用 `<script setup lang="ts">` 语法
- [ ] Props 带完整类型定义
- [ ] Emits 使用函数形式定义
- [ ] CSS 使用 scoped 作用域
- [ ] 类名使用 kebab-case
