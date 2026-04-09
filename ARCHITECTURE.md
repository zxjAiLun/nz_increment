# 架构说明

## 组件结构

`App.vue`（125行）作为根组件，管理以下子组件：

| 组件 | 行数 | 职责 |
|------|------|------|
| `PlayerStatusBar.vue` | 201 | 顶部玩家状态（生命/金币/等级等） |
| `OverlayContainer.vue` | 68 | 弹窗/遮罩容器 |
| `TabsContainer.vue` | 97 | Tab 切换容器 |
| `DebugPanel.vue` | 282 | 调试面板 |
| `PauseOverlay.vue` | 54 | 暂停遮罩 |
| `RebirthModal.vue` | 349 | 转生弹窗 |

原有大组件已拆分为独立 Tab 页面：
- `BattleTab.vue` — 战斗/推图
- `RoleTab.vue` — 角色/属性
- `ShopTab.vue` — 商店/抽奖
- `SkillsTab.vue` — 技能管理
- `SettingsTab.vue` — 游戏设置

## 游戏循环

`composables/useGameLoop.ts` 替代了原有的 setInterval：

- 使用 `requestAnimationFrame` 实现流畅的 60fps 游戏循环
- 支持暂停/恢复控制
- 监听 `visibilitychange` 事件，页面隐藏时自动暂停
- 独立的 tick 间隔控制（默认 100ms）

## 常量管理

`utils/constants.ts` 集中所有配置常量，避免魔法数字散落各处：

- `CRIT` — 暴击率/暴击伤害
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
