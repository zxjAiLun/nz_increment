# Review: iter-23/theme-system (commit ab546c8)

## 变更范围

| 文件 | 改动 |
|------|------|
| src/data/themes.ts | Theme 接口 + 5个主题定义 |
| src/stores/themeStore.ts | Pinia store (ownedThemes/unlockTheme/setTheme/applyTheme) |
| src/components/ThemeShop.vue | 主题商店 UI |
| src/stores/playerStore.ts | 新增 spendDiamonds() |
| src/components/SettingsTab.vue | 添加主题商店入口 |

---

## 验证结果

### grep 验证（通过）

```
src/data/themes.ts:21:export const THEMES: Theme[] = [
src/stores/themeStore.ts:3:import { THEMES } from '../data/themes'
src/stores/themeStore.ts:9:export const useThemeStore = defineStore('theme', () => {
src/stores/themeStore.ts:15:THEMES.find(t => t.id === currentThemeId.value) || THEMES[0]
src/stores/themeStore.ts:23:const theme = THEMES.find(t => t.id === themeId)
src/stores/themeStore.ts:34:applyTheme(THEMES.find(t => t.id === themeId)!.colors)
src/stores/themeStore.ts:37:function applyTheme(colors: Theme['colors']) {
src/stores/themeStore.ts:39:root.style.setProperty('--color-primary', colors.primary)
```

基础引用链路正确。

---

## CRITICAL BUG: 主题切换覆盖不完整

### 问题描述

`themeStore.applyTheme()` 只设置了 **10 个** CSS 变量：

```
--color-primary, --color-secondary, --color-accent,
--color-background, --color-surface, --color-text,
--color-crit, --color-heal, --color-gold, --color-diamond
```

但现有代码中有 **150+ 处**使用了未被新系统覆盖的变量：

| 变量 | 使用次数（grep 命中） |
|------|----------------------|
| `--color-bg-panel` | 大量 |
| `--color-bg-dark` | 大量 |
| `--color-bg-card` | 大量 |
| `--color-text-muted` | 大量 |
| `--color-accent-light` | 有 |
| `--color-text-disabled` | 有 |
| `--color-bg-input` | 有 |
| `--color-text-secondary` | 有 |

### 实际影响

现有组件（RebirthModal、ShopTab、TabsContainer 等）使用这些"遗留变量"渲染背景、面板、禁用态等。主题切换后这些元素**完全不变**，只有少数按钮/文字颜色会变。

主题切换的视觉效果约等于零——用户体验是"点了没反应"。

### 根因

`design-system.css` 仍被导入（App.vue:116 等），其定义的 `:root` 变量会作为默认值保留。`applyTheme()` 覆盖了 10 个，但剩下至少 8 个关键变量完全没处理。

---

## 次要问题

### 1. particleEffect 是死代码

```ts
// themes.ts
particleEffect?: string  // 'flame' | 'ice' | 'shadow' | 'sparkle'
```

定义存在于所有 5 个主题，但全项目 grep 无任何代码引用这些值。粒子特效系统未实现。

### 2. 旧 CSS 主题文件未清理

```
src/styles/themes/
  theme-fantasy.css, theme-pixel.css, theme-neon.css ...
```

这些文件在 commit 中未被删除，但也没有任何 import 引用它们。可能是从旧系统遗留，目前是死代码。

### 3. spendDiamonds 和 unlockTheme 逻辑正确

```ts
// playerStore.ts
function spendDiamonds(amount: number): boolean {
  if (player.value.diamond < amount) return false
  player.value.diamond -= amount
  return true
}
```
```ts
// themeStore.ts
function unlockTheme(themeId: string): boolean {
  const theme = THEMES.find(t => t.id === themeId)
  if (!theme || ownedThemes.value.includes(themeId)) return false
  ownedThemes.value.push(themeId)
  saveOwned()
  return true
}
```
两者都有空值/重入保护，逻辑正确。

### 4. setTheme 有 ownedThemes 校验

```ts
function setTheme(themeId: string) {
  if (!ownedThemes.value.includes(themeId)) return
  // ...
}
```
未解锁的主题无法装备，逻辑正确。

---

## 结论

**FAIL**

基础架构（store 结构、主题数据、购买/解锁流程）是通的，但**核心功能不工作**：主题切换只改变少量颜色，大量 UI 元素（背景、面板、次要文字）完全不受影响。CRITICAL BUG 必须修复后才能算可用。

### 必须修复

1. 在 `applyTheme()` 中补充缺失的 CSS 变量映射，至少包括：
   - `--color-bg-dark`, `--color-bg-panel`, `--color-bg-card`, `--color-bg-input`
   - `--color-text-secondary`, `--color-text-muted`, `--color-text-disabled`
   - `--color-accent-light`, `--color-primary-light`, `--color-primary-dark`

2. 或者：如果新系统是有意简化，则需先迁移所有使用遗留变量的组件。

### 建议修复

- 删除或注释掉 `particleEffect` 字段，避免误导
- 清理 `src/styles/themes/` 下无引用的 CSS 文件（或说明保留原因）
