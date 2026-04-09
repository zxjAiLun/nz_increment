# nz_increment 开发规则

---

## 技术栈（禁止更改）

Vue 3.4 + Pinia 2.1 + TypeScript 5.4 + Vite 5.2，原生 CSS，禁止引入任何 UI 框架或新的运行时依赖。

---

## 文件结构

```
App.vue ≤ 200 行（仅布局），单个 .vue ≤ 400 行
业务逻辑 → composables/ 或 stores/
工具函数 → utils/（不得引用 Vue/Pinia）
```

---

## 组件

- Props/Emit 用 TypeScript interface + `withDefaults`/`defineEmits` 函数形式
- 禁止裸 `ref([])`，必须显式类型
- 颜色从 `utils/constants.ts` 引入，禁止硬编码

---

## Pinia Store

| store | 职责 |
|---|---|
| playerStore | 属性/装备/背包 |
| monsterStore | 怪物/难度 |
| gameStore | 战斗/行动槽/伤害统计 |
| skillStore | 技能解锁/冷却 |

跨 store 访问在 action 内部延迟调用，禁止在 store 顶层直接 import 另一个 store。组件内用 `storeToRefs` 保持响应性。

---

## 伤害公式（强制顺序）

```
命中判定 → 基础伤害(攻击力) → 暴击 → 增伤 → 护甲 → 真实/虚空(最后加)
```

暴击常量（`CRIT.BASE_RATE = 5`、`CRIT.BASE_DAMAGE = 150` 等）禁止硬编码。溢出保护：`Math.min(1e15, ...)` + 除法守卫 `b === 0 ? fallback : a / b`。

---

## 战斗

- 速度比 ≥ 2：先手 + 同 tick 执行两次行动
- GAUGE_MAX = 100，禁止改动

---

## 测试

框架：**Vitest**。必须覆盖：伤害公式（命中/暴击/护甲/真伤）、装备评分、数值溢出保护。禁止 `describe.skip`/`it.skip`。每个测例需 mock `Math.random` 保证确定性。

---

## 禁止

- options API（必须 `<script setup>`）
- utils 内 import Vue/Pinia
- `any` 类型（localStorage 反序列化除外）
- 递归超过 3 层
- `setTimeout`/`setInterval` 代替 `gameLoop`
- `console.log`（生产代码）
- 业务逻辑写在 `.vue` 内

---

## 数据持久化

存档 key：`nz_player_v1` / `nz_game_v1` / `nz_meta_v1`。破坏性变更必须 +1 版本号并写 `migrateSave` 迁移函数。
