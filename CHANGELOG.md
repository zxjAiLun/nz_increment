# 更新日志

## [Unreleased]

### 架构重建
- 新建 `src/utils/constants.ts` 集中管理魔法数字
- 新建 `src/composables/useGameLoop.ts` 用 requestAnimationFrame 替代 setInterval
- 重构 App.vue：1235行 → 125行，拆分为 6 个组件
- 禁用 Vue options API（vite.config.ts）

### 新增
- 项目初始架构完成（Vue 3 + TypeScript + Pinia）
- 12个属性系统（基础/进阶/高级/终极）
- 24个主动技能
- 8级装备稀有度系统（common → eternal）
- 12个装备槽位
- 练功房系统
- 转生系统
- 成就系统
- 离线收益系统

### 修复
- （暂无修复记录）

### 优化
- （暂无优化记录）

### 文档
- 初始项目文档（README.md、RULES.md、DEVELOPMENT_PLAN.md）
- 类型定义文档（src/types/index.ts）
