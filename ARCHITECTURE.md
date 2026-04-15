# 架构说明

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **状态管理**: Pinia
- **语言**: TypeScript
- **构建工具**: Vite
- **样式**: 原生 CSS（无 UI 框架）

## 目录结构

```
src/
├── App.vue                      # 根组件（125行）
├── main.ts                      # 入口文件
├── types/
│   └── index.ts                 # 类型定义（300行）
├── stores/                      # Pinia 状态管理
│   ├── playerStore.ts           # 玩家状态
│   ├── gameStore.ts             # 战斗循环
│   ├── monsterStore.ts          # 怪物系统
│   ├── skillStore.ts            # 技能管理
│   ├── gachaStore.ts            # 抽卡系统
│   ├── cultivationStore.ts      # 命座/觉醒
│   ├── equipmentUpgradeStore.ts # 装备升级
│   ├── challengeStore.ts        # 每日/每周挑战
│   ├── battlePassStore.ts       # 战令
│   ├── seasonTaskStore.ts      # 赛季任务
│   └── [其他业务 store]
├── utils/
│   ├── calc.ts                  # 核心数值计算
│   ├── constants.ts             # 集中管理魔法数字
│   ├── monsterGenerator.ts      # 怪物生成
│   ├── equipmentGenerator.ts    # 装备生成
│   ├── skillSystem.ts           # 技能定义与执行
│   ├── passiveEvaluator.ts      # 被动技能条件判定
│   ├── equipmentSetCalculator.ts # 套装效果计算
│   └── [其他工具]
├── composables/
│   ├── useGameLoop.ts           # requestAnimationFrame 游戏循环
│   ├── useSkillExecutor.ts      # 技能执行器
│   └── useTheme.ts              # 主题管理
├── components/                  # Vue 组件
│   ├── BattleTab.vue             # 战斗/推图
│   ├── RoleTab.vue              # 角色/属性
│   ├── CultivationTab.vue       # 命座/觉醒
│   ├── GachaTab.vue             # 抽卡
│   ├── EquipmentDetailModal.vue # 装备详情弹窗
│   ├── PassiveSkillsPanel.vue   # 被动技能面板
│   ├── BattleHUD.vue            # 战斗 HUD
│   ├── BattleLog.vue            # 战斗日志
│   ├── PlayerStatusBar.vue      # 顶部状态栏
│   ├── TabsContainer.vue        # Tab 容器
│   ├── TabNavigation.vue        # Tab 导航
│   ├── ChallengePanel.vue        # 挑战面板
│   ├── BattlePassTab.vue        # 战令
│   └── [其他 UI 组件]
├── data/                        # 游戏数据配置
│   ├── gachaPools.ts            # 抽卡池配置
│   ├── passiveSkills.ts        # 被动技能定义
│   ├── equipmentSets.ts        # 套装效果定义
│   ├── achievements.ts         # 成就数据
│   ├── seasons.ts              # 赛季配置
│   ├── battlePassRewards.ts    # 战令奖励
│   ├── synergySkills.ts        # 技能协同效果
│   └── [其他游戏数据]
├── i18n/                        # 国际化
├── styles/themes/               # 主题样式
└── types/                       # TypeScript 类型
```

## 组件结构

根组件 `App.vue`（125行）管理以下顶层组件：

| 组件 | 职责 |
|------|------|
| `PlayerStatusBar.vue` | 顶部玩家状态（生命/金币/难度等） |
| `OverlayContainer.vue` | 弹窗/遮罩容器 |
| `TabsContainer.vue` | Tab 切换容器 |
| `DebugPanel.vue` | 调试面板 |
| `PauseOverlay.vue` | 暂停遮罩 |
| `RebirthModal.vue` | 转生弹窗 |

## 游戏循环

`composables/useGameLoop.ts` 替代原有的 setInterval：

- 使用 `requestAnimationFrame` 实现 60fps 游戏循环
- 支持暂停/恢复控制
- 监听 `visibilitychange`，页面隐藏时自动暂停
- 独立 tick 间隔控制（默认 100ms）

## 常量管理

`utils/constants.ts` 集中所有配置常量，避免魔法数字散落：

- `CRIT` — 暴击率/暴击伤害配置
- `GAUGE_MAX` — 能量槽上限
- `DEFENSE_DIVISOR` — 防御力公式分母
- `HIT` — 命中概率范围
- `SPEED` — 速度/双动/先手常量
- `LIFESTEAL` — 生命偷取
- `GAME` — 主循环/存档间隔
- `COLORS` — 主题颜色

## 技术决策

### 禁用 Vue Options API

`vite.config.ts` 中已禁用 Options API：
```typescript
define: {
  __VUE_OPTIONS_API__: 'false'
}
```

强制使用 Composition API，确保代码风格统一。

### 组件通信

通过 Pinia store 进行跨组件状态共享，组件间通过 props/emits 进行父子通信。

### 技能执行

`composables/useSkillExecutor.ts` 统一处理技能触发逻辑，替代散落在各处的技能代码。

### 被动技能判定

`utils/passiveEvaluator.ts` 集中处理条件触发型被动技能的条件判定与效果应用。
