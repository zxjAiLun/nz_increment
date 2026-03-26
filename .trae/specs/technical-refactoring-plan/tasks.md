# 任务列表 - 技术重构与代码质量改进

> **重要提示**: 实施所有任务时必须使用 `/frontend-dev` skill 进行 UI 组件开发

## P0 紧急重构（必须立即处理）

### 任务 1: App.vue 拆分重构
- [ ] 1.1: 创建项目目录结构
  - 创建 `src/components/Battle/` 目录
  - 创建 `src/components/Player/` 目录
  - 创建 `src/components/Shop/` 目录
  - 创建 `src/components/Common/` 目录
  - 创建 `src/composables/` 目录

- [ ] 1.2: 创建 TabNavigation 组件
  - 从 App.vue 提取 Tab 导航逻辑
  - 实现 Tab 切换状态管理
  - 添加 Tab 切换动画

- [ ] 1.3: 创建 BattleHUD 组件
  - 从 App.vue 提取战斗 HUD 逻辑
  - 包含玩家/怪物血条、行动槽
  - 包含技能按钮区域

- [ ] 1.4: 创建 PlayerPanel 组件
  - 从 App.vue 提取玩家面板逻辑
  - 包含属性显示、装备栏
  - 包含技能学习区域

- [ ] 1.5: 创建 ShopTab 组件
  - 从 App.vue 提取商店逻辑
  - 包含属性购买、技能学习、装备抽卡

- [ ] 1.6: 创建 SettingsTab 组件
  - 从 App.vue 提取设置逻辑
  - 包含音效、游戏速度等设置

- [ ] 1.7: 创建 composables 组合式函数
  - 创建 `useBattle.ts` 封装战斗流程逻辑
  - 创建 `useEquipment.ts` 封装装备逻辑
  - 创建 `useOffline.ts` 封装离线收益逻辑

- [ ] 1.8: 精简 App.vue
  - 仅保留布局和 Tab 路由逻辑
  - 确保总行数 ≤ 200 行
  - 清理所有业务逻辑代码

### 任务 2: 暴击系统统一
- [x] 2.1: 在 calc.ts 添加 CRIT_CONSTANTS ✅
  ```typescript
  export const CRIT_CONSTANTS = {
    BASE_CRIT_RATE: 5,
    BASE_CRIT_DAMAGE: 150,
    MIN_CRIT_MULT: 1.2,
    MAX_CRIT_RATE: 50,
    CRIT_RESIST_FACTOR: 0.5,
    CRIT_DMG_RESIST_FACTOR: 0.2
  } as const
  ```

- [x] 2.2: 创建 calculateCrit 统一函数 ✅
  - 接收攻击者和防御者属性
  - 返回 { isCrit, critMultiplier, effectiveCritRate }
  - 使用统一的暴击计算逻辑

- [x] 2.3: 重构 calculatePlayerDamage ✅
  - 替换内联暴击逻辑为 calculateCrit 调用
  - 确保与 calculateMonsterDamage 对称

- [x] 2.4: 重构 calculateMonsterDamage ✅
  - 替换内联暴击逻辑为 calculateCrit 调用
  - 修复 critResist 不对称问题

### 任务 3: 速度优势双行动实现
- [x] 3.1: 分析现有 calculateSpeedAdvantage 函数 ✅
  - 确认返回值包含 hasExtraTurn 和 extraTurnDamageBonus
  - 确认速度比计算逻辑

- [x] 3.2: 修改 gameLoop 逻辑 ✅
  - 在玩家回合后检查 hasExtraTurn
  - 如果 true，立即执行第二次 processPlayerAttack
  - 应用 extraTurnDamageBonus (10%) 到第二次攻击

- [x] 3.3: 添加双行动视觉反馈 ✅
  - 显示"⚡ 双倍行动!"提示
  - 第二次攻击时添加特殊标记

---

## P1 重要重构（高优先级）

### 任务 4: BUFF 系统重构
- [ ] 4.1: 分析当前 BUFF 数据结构
  - 查看 activeBuffs 的 Map 结构
  - 确认 BUFF 与 Skill 的关联方式

- [ ] 4.2: 重构 BUFF 数据结构
  ```typescript
  interface ActiveBuff {
    skillId: string
    statType: StatType
    value: number
    startTime: number
    duration: number
    stacks: number
  }
  ```

- [ ] 4.3: 修改 applyBuff 函数
  - 支持同名 BUFF 叠加（增加 stacks）
  - 存储 skillId 引用

- [ ] 4.4: 修复 getBuffOriginalDuration
  - 从 buff 的 skillId 直接查找技能
  - 不再从技能列表反查

### 任务 5: Combo 系统接入
- [ ] 5.1: 分析 getPlayerHitCount 函数
  - 确认 combo 值的计算方式
  - 确认返回值意义

- [ ] 5.2: 在 calculatePlayerDamage 接入连击
  - 根据 getPlayerHitCount 返回连击次数
  - 将伤害均分到每次攻击

- [ ] 5.3: 添加连击 UI 反馈
  - 在 BattleHUD 显示连击计数器
  - 显示"连击 x2!"等提示

### 任务 6: 数值平衡修复
- [ ] 6.1: 分析怪物防御增长公式
  - 找到 monsterGenerator.ts 中的防御计算
  - 分析 baseValue × 6 的影响

- [ ] 6.2: 调整怪物防御增长
  - 将 baseValue × 6 调整为 baseValue × 4
  - 或引入难度衰减系数

- [ ] 6.3: 分析抽奖成本公式
  - 找到 doLottery 中的成本计算
  - 分析 1.005^x 的增长速度

- [ ] 6.4: 修复抽奖成本
  - 调整增长系数（1.003 或 1.002）
  - 或设置成本上限

---

## P2 中等优先级

### 任务 7: accuracy 属性修正
- [ ] 7.1: 分析当前命中公式
  - 查看 calc.ts 中的 hitChance 计算
  - 确认 accuracy 和 dodge 的使用方式

- [ ] 7.2: 修正命中公式
  - 改为: `hitChance = Math.min(0.95, 0.8 + attacker.accuracy - defender.dodge * 0.5)`

### 任务 8: doLottery 递归改循环
- [ ] 8.1: 分析 doLottery 函数
  - 查看当前递归实现
  - 识别递归调用点

- [ ] 8.2: 改写为 while 循环
  - 替换递归为 while 循环
  - 确保逻辑完全一致

### 任务 9: 伤害飘字系统接入
- [ ] 9.1: 分析 DamagePopup.vue 组件
  - 查看组件接口定义
  - 确认动画效果实现

- [ ] 9.2: 在战斗流程触发飘字
  - 在 calculatePlayerDamage 返回 DamageResult
  - 组件监听伤害事件并显示飘字

- [ ] 9.3: 添加所有伤害类型支持
  - 普通伤害: 青色
  - 暴击: 红色 + 放大
  - 真实伤害: 金色
  - 虚空伤害: 橙色

### 任务 10: 存档版本迁移机制
- [ ] 10.1: 定义 SaveDataV1 和 SaveDataV2 类型
  - V1: { version: 1, player, game }
  - V2: { version: 2, player, game, achievements }

- [ ] 10.2: 实现 migrateSaveData 函数
  - 检测当前版本号
  - 执行相应迁移逻辑

- [ ] 10.3: 在加载存档时调用迁移
  - 在 playerStore 或 gameStore 的初始化逻辑中

---

## P3 低优先级

### 任务 11: 离线奖励公式修正
- [ ] 11.1: 分析 calculateOfflineReward 函数
  - 找到 monster.attack 的使用位置
  - 确认应该是 player.stats.attack

- [ ] 11.2: 修正公式
  - 替换 monster.attack 为 player.stats.attack
  - 验证计算结果合理性

---

## 任务依赖关系

```
P0 紧急重构
├── 任务 1 (App.vue 拆分)
│   └── 任务 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8
├── 任务 2 (暴击系统统一)
│   └── 2.1 → 2.2 → 2.3 → 2.4
└── 任务 3 (速度优势双行动)
    └── 3.1 → 3.2 → 3.3

P1 重要重构
├── 任务 4 (BUFF 系统)
│   └── 4.1 → 4.2 → 4.3 → 4.4
├── 任务 5 (Combo 系统)
│   └── 5.1 → 5.2 → 5.3
└── 任务 6 (数值平衡)
    └── 6.1 → 6.2 → 6.3 → 6.4

P2 中等优先级
├── 任务 7 (accuracy 修正)
├── 任务 8 (递归改循环)
├── 任务 9 (伤害飘字)
└── 任务 10 (存档迁移)
    └── 10.1 → 10.2 → 10.3

P3 低优先级
└── 任务 11 (离线奖励修正)
```

## 建议实施顺序

1. **阶段 1 (P0 基础)**: 任务 1.1 → 1.2 → 任务 2 → 任务 3
2. **阶段 2 (P0 完成)**: 任务 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8
3. **阶段 3 (P1 核心)**: 任务 4 → 任务 5 → 任务 6
4. **阶段 4 (P2 完善)**: 任务 7 → 任务 8 → 任务 9 → 任务 10
5. **阶段 5 (P3 收尾)**: 任务 11

---

## 验收标准

- [ ] App.vue 行数 ≤ 200 行
- [ ] 单个 .vue 文件 ≤ 400 行
- [ ] 所有 TypeScript 类型检查通过
- [ ] 暴击计算使用统一函数和常量
- [ ] 速度优势双行动正常工作
- [ ] BUFF 系统支持叠加
- [ ] 连击系统正确计算伤害分配
- [ ] 存档迁移机制正常工作
