# nz_increment 项目分析报告 & 前端开发规范

> 项目：棒棒糖大冒险 (Lollipop Adventure)
> 技术栈：Vue 3 (Composition API) + TypeScript + Pinia + Vite
> 类型：增量/放置类 RPG 网页游戏

---

## 一、项目现状分析

### 1.1 技术架构

```
nz_increment/
├── src/
│   ├── App.vue                    # 主 UI（2600+ 行，混合了展示和逻辑）
│   ├── types/index.ts             # 类型定义（300 行）
│   ├── stores/
│   │   ├── playerStore.ts         # 玩家状态 + 属性计算（594 行）
│   │   ├── monsterStore.ts        # 怪物系统（136 行）
│   │   ├── gameStore.ts           # 战斗循环 + 伤害统计（423 行）
│   │   ├── trainingStore.ts       # 练功房系统（161 行）
│   │   ├── skillStore.ts          # 技能管理
│   │   ├── achievementStore.ts    # 成就系统
│   │   └── rebirthStore.ts        # 转生系统（231 行）
│   ├── utils/
│   │   ├── calc.ts                # 核心数值计算（258 行）
│   │   ├── skillSystem.ts         # 技能定义（435 行）
│   │   ├── equipmentGenerator.ts  # 装备生成（172 行）
│   │   ├── monsterGenerator.ts     # 怪物生成（93 行）
│   │   └── achievementChecker.ts  # 成就检查
│   └── components/                # 7 个 UI 组件
```

### 1.2 发现的问题

#### 🔴 严重问题

**P1. 暴击判定逻辑重复且不一致**

`calc.ts` 里两套暴击逻辑：

```typescript
// calculatePlayerDamage 中的暴击
const isCrit = Math.random() * 100 < critChance
if (isCrit) {
  const critMult = Math.max(1.2, totalStats.critDamage / 100 - monster.critResist * 0.2)
  damage *= critMult
}

// calculateMonsterDamage 中的暴击几乎相同
const isCrit = Math.random() * 100 < critChance
if (isCrit) {
  const critMult = Math.max(1.2, monster.critDamage / 100 - totalStats.critResist * 0.2)
  damage *= critMult
}
```

问题：`critResist` 在两边的减成公式不对称（玩家端用 `monster.critResist`，怪物端用 `totalStats.critResist`），且 `critDamage / 100` 没有处理 `critDamage` 本身可能是百分比的问题（`critDamage` 初始值 150 表示 150%）。

**P2. `App.vue` 职责过于臃肿**

2600+ 行文件，包含所有 Tab 的渲染逻辑、战斗 HUD、确认对话框、商店、设置页。违反 Vue 单组件原则，后续维护困难，任何 UI 修改都可能触发逻辑 bug。

**P3. BUFF 系统数据设计缺陷**

```typescript
// playerStore.ts
const activeBuffs = ref<Map<StatType, { value: number; endTime: number }>>(new Map())
```

- BUFF 只存了 `stat`，没有关联到具体的 Skill
- `getBuffOriginalDuration` 从技能列表反查 duration，但技能可能已经被卸载
- 多个同名 BUFF 会互相覆盖而不是叠加

**P4. 速度优势逻辑未完整实现**

```typescript
// gameStore.ts - 有先手判断，但后续没有真的给双行动机会
function calculateSpeedAdvantage(...): { hasDoubleTurn: boolean, ... } {
  if (speedRatio >= 2) return { hasDoubleTurn: true, ... }
}
```

`hasDoubleTurn: true` 但 `gameLoop` 里根本没有"执行双行动"的分支，这个字段成了摆设。

#### 🟡 中等问题

**P5. `accuracy` 属性应用错误**

```typescript
// calc.ts - calculatePlayerDamage
const hitChance = Math.max(0.05, 0.95 - monster.accuracy * 0.01 + totalStats.dodge * 0.01)
```

`accuracy` 的语义是"必中概率"，但代码把它当成"命中率减成"来用。应该是：`hitChance = Math.min(0.95, totalStats.accuracy + 0.8)` 之类的公式更合理。

**P6. 相位解锁公式可能产生 Phase 0**

```typescript
// playerStore.ts
function getPlayerPhase(): number {
  return Math.min(Math.floor(player.value.level / 5) + 1, 7)  // level=1 → phase=1
}
function checkPhaseUnlock() {
  const newPhase = Math.min(Math.floor(player.value.level / 5) + 1, 7)  // level=0-4 → phase=1
  // 但初始 level=1, unlockedPhases=[1]，没问题
}
```

当 `level=0` 时会得到 Phase 0，但初始 `level=1` 所以暂时安全，不过 `level / 5` 的取整逻辑容易产生 off-by-one。

**P7. Combo 系统未连接到伤害**

```typescript
// calc.ts
export function getPlayerHitCount(totalStats: PlayerStats): number {
  const baseCombo = totalStats.combo / 100
  return Math.max(1, Math.floor(baseCombo))
}
```

`getPlayerHitCount` 被定义但从未被调用，连击系统的伤害分配没有实现。

**P8. 数值平衡问题（README 已指出）**

| 问题 | 严重程度 | 描述 |
|---|---|---|
| 怪物防御增长过快 | 🔴 高 | `baseValue × 6`，后期玩家穿甲不够根本打不动 |
| 抽奖成本指数爆炸 | 🔴 高 | `1.005^x` 增长，金币收益跟不上 |
| 真实/虚空伤害占比过高 | 🟡 中 | 说明穿透和穿甲设计失衡 |
| 幸运值实际效果有限 | 🟡 中 | 幸运值后期边际效益低 |

#### 🟢 轻微问题

**P9. `doLottery` 递归可能导致栈溢出**

```typescript
// playerStore.ts - doLottery
if (!isStatUnlocked(stat)) {
  return doLottery()  // 递归调用自己，如果大量属性未解锁会持续递归
}
```

**P10. 离线奖励计算用 `monster.attack` 代替 `player.stats.attack`**

```typescript
// calc.ts - calculateOfflineReward
const baseGoldPerSecond = player.stats.attack * 0.2 * ...  // 正确
// 但怪物攻击力和玩家金币获取没有逻辑关联，这行数值是拍脑袋的
```

---

## 二、前端开发规范（Rules）

### 2.1 项目结构规范

```
src/
├── components/          # UI 组件，单一职责
│   ├── Battle/          # 战斗相关组件
│   │   ├── BattleHUD.vue
│   │   ├── BattleLog.vue
│   │   └── DamagePopup.vue
│   ├── Player/          # 玩家相关
│   │   ├── PlayerPanel.vue
│   │   ├── StatsPanel.vue
│   │   └── EquipmentSlot.vue
│   ├── Shop/            # 商店
│   │   └── ShopTab.vue
│   └── Common/          # 通用
│       ├── ConfirmDialog.vue
│       └── TabNavigation.vue
├── composables/         # 组合式函数，封装复用逻辑
│   ├── useBattle.ts     # 战斗流程逻辑
│   ├── useEquipment.ts  # 装备逻辑
│   └── useOffline.ts    # 离线收益
├── stores/              # Pinia store，状态管理
│   ├── playerStore.ts
│   ├── monsterStore.ts
│   ├── gameStore.ts
│   └── ...
├── utils/               # 纯函数工具，不依赖 Vue/Pinia
│   ├── calc.ts          # 数值计算
│   ├── format.ts        # 格式化
│   └── generators/      # 生成器
│       ├── equipmentGenerator.ts
│       └── monsterGenerator.ts
├── types/               # TypeScript 类型
│   └── index.ts
└── App.vue              # 根组件，仅做路由/布局，不写业务逻辑
```

**强制规则：**
- `App.vue` 不超过 **200 行**，只做布局和 Tab 路由
- 单个 `.vue` 文件不超过 **400 行**
- 业务逻辑必须进 `composables` 或 `stores`，不写在组件里
- 工具函数必须进 `utils`，不引用 Vue/Pinia

### 2.2 组件规范

#### 2.2.1 组件模板结构

```vue
<template>
  <div class="component-name">
    <!-- 纯展示，无逻辑 -->
    <slot name="header" />
    <div class="content">
      <!-- 数据用 computed，事件用方法 -->
    </div>
    <slot name="footer" />
  </div>
</template>

<script setup lang="ts">
// 顺序：类型定义 → 常量 → computed → methods → lifecycle
// 禁止在 template 里写复杂表达式
</script>

<style scoped>
/* CSS 类命名：kebab-case + BEM 变体 */
.component-name { }
.component-name__header { }
.component-name--active { }
</style>
```

#### 2.2.2 Props 和 Emit

```typescript
// ✅ 正确：带类型、默认值、注释
interface Props {
  /** 怪物当前 HP */
  currentHp: number
  /** 最大 HP */
  maxHp: number
  /** 是否显示伤害飘字 */
  showDamagePopup?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showDamagePopup: true
})

// ✅ 正确：emit 用函数形式，类型明确
const emit = defineEmits<{
  (e: 'skill-used', skillId: string): void
  (e: 'player-dead'): void
}>()

// ❌ 错误：直接写对象形式
// const emit = defineEmits({ skillUsed: () => {} })
```

#### 2.2.3 响应式数据规范

```typescript
// ✅ 正确：用 ref/reactive，显式类型
const playerHp = ref<number>(100)
const isPaused = ref<boolean>(false)

// ❌ 错误：隐式 any
// const playerHp = ref(100)

// ✅ 正确：复杂对象用 reactive + 类型
const damageStats = reactive<DamageStats>({
  totalDamage: 0,
  normalDamage: 0,
  critDamage: 0,
  ...
})

// ❌ 错误：数组 push 后不触发响应
// const log = ref([])
// log.value.push('msg')  // 可能不响应
```

### 2.3 状态管理规范（Pinia）

#### 2.3.1 Store 设计原则

```
一个 Store = 一个数据域 + 该数据域的纯操作
```

```typescript
// ✅ 正确：职责单一
// gameStore.ts → 战斗流程、游戏状态
// playerStore.ts → 玩家属性、装备、背包
// monsterStore.ts → 怪物生成、难度

// ❌ 错误：跨 Store 直接修改对方状态
// playerStore.takeDamage() 在 gameStore 里直接调用
// 应该通过 emit 或 action 包装
```

#### 2.3.2 State 访问规则

```typescript
// ✅ 正确：组件里用 storeToRefs 保持响应性
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/gameStore'

const gameStore = useGameStore()
const { isPaused, battleLog } = storeToRefs(gameStore)
const { togglePause } = gameStore

// ❌ 错误：解构时丢失响应性
// const { isPaused } = useGameStore()
```

#### 2.3.3 跨 Store 通信

```typescript
// ✅ 正确：通过 action 包装，不直接引用其他 store
// gameStore.ts
import { usePlayerStore } from './playerStore'

function processPlayerAttack() {
  const playerStore = usePlayerStore()  // 延迟调用，避免循环引用
  // ... 使用 playerStore
}

// ❌ 错误：在 store 定义顶层 import 其他 store
// import { usePlayerStore } from './playerStore'
// const playerStore = usePlayerStore()  // 会在 store 初始化时出错
```

### 2.4 数值计算规范（calc.ts）

#### 2.4.1 伤害公式模板

```typescript
interface DamageResult {
  finalDamage: number      // 最终伤害
  isCrit: boolean         // 是否暴击
  isDodge: boolean        // 是否闪避
  isHit: boolean          // 是否命中
  damageType: 'normal' | 'crit' | 'true' | 'void'
}

function calculateDamage(
  attacker: { attack: number; critRate: number; critDamage: number; ... },
  defender: { defense: number; dodge: number; critResist: number; ... },
  options: {
    ignoreDefense?: boolean
    defenseIgnorePercent?: number
    trueDamage?: number
    voidDamage?: number
    skillDamageBonus?: number
  }
): DamageResult {
  // 1. 命中判定
  const hitChance = Math.min(0.95, 0.8 + attacker.accuracy)
  if (Math.random() > hitChance) return { finalDamage: 0, isDodge: true, ... }

  // 2. 基础伤害 = 攻击力
  let damage = attacker.attack

  // 3. 暴击（独立判定，在增伤之前）
  let isCrit = false
  const effectiveCritRate = Math.max(0, attacker.critRate - defender.critResist * 0.5)
  if (Math.random() * 100 < effectiveCritRate) {
    isCrit = true
    damage *= Math.max(1.2, attacker.critDamage / 100)
  }

  // 4. 增伤区（百分比乘算，在暴击之后）
  damage *= (1 + attacker.damageBonusI / 100)
  damage *= (1 + attacker.damageBonusII / 100)

  // 5. 护甲计算（暴击后）
  if (!options.ignoreDefense) {
    const defAfterPen = Math.max(0, defender.defense * (1 - options.defenseIgnorePercent / 100) - attacker.penetration)
    const reduction = defAfterPen / (defAfterPen + 200)
    damage *= (1 - reduction)
    damage = Math.max(damage, attacker.attack * 0.1)  // 保底 10% 攻击力
  }

  // 6. 真实伤害（固定值加法，不受护甲和暴击影响）
  damage += options.trueDamage ?? 0
  damage += options.voidDamage ?? 0

  return { finalDamage: Math.floor(damage), isCrit, ... }
}
```

**公式顺序规则：**
```
暴击 = (攻击力 × 暴击倍率)    ← 先算
增伤 = 最终伤害 × 增伤系数     ← 次算
护甲 = 最终伤害 × (1-减伤率)  ← 后算
真实 = 最终伤害 + 固定值      ← 最后加
```
顺序错误会导致伤害放大或缩小失控。

#### 2.4.2 暴击相关常量规范

```typescript
// 所有暴击相关的值统一管理，不散落各处
export const CRIT_CONSTANTS = {
  BASE_CRIT_RATE: 5,           // 基础暴击率 5%
  BASE_CRIT_DAMAGE: 150,       // 基础暴击伤害 150%
  MIN_CRIT_MULT: 1.2,          // 最低暴击倍率
  MAX_CRIT_RATE: 50,           // 暴击率上限 50%
  CRIT_RESIST_FACTOR: 0.5,     // 暴击抵抗削减暴击率的系数
  CRIT_DMG_RESIST_FACTOR: 0.2 // 暴击伤害抗性削减系数的系数
} as const
```

#### 2.4.3 数值溢出保护

```typescript
// ✅ 正确：所有除法前检查
function safeDivide(a: number, b: number, fallback: number = 0): number {
  return b === 0 ? fallback : a / b
}

// ✅ 正确：乘法和幂次前做 clamp
const critRate = Math.min(100, Math.max(0, value))
const goldReward = Math.min(1e15, baseValue * multiplier)  // 防止科学计数法溢出
```

### 2.5 战斗流程规范

#### 2.5.1 行动槽（Action Gauge）系统

```typescript
interface GaugeConfig {
  GAUGE_MAX: 100           // 槽位上限
  GAUGE_TICK_RATE: 10      // 每点速度对应的充能速度
  TICK_INTERVAL: 16         // 刷新间隔 ms（约 60fps）
}

// 速度换算：spd=10 的角色，每 16ms 充能 10*10/100 = 1 点
// 速度=100 时，每 16ms 充能 10 点，100ms 满槽
// 速度=10 时，每 100ms 满槽
```

#### 2.5.2 速度优势和先手规范

```typescript
interface SpeedAdvantage {
  /** 玩家是否更快 */
  hasAdvantage: boolean
  /** 是否获得额外行动 */
  hasExtraTurn: boolean
  /** 额外行动的伤害加成 */
  extraTurnDamageBonus: number
}

function calculateSpeedAdvantage(playerSpeed: number, monsterSpeed: number): SpeedAdvantage {
  const ratio = playerSpeed / monsterSpeed
  if (ratio >= 2) {
    return { hasAdvantage: true, hasExtraTurn: true, extraTurnDamageBonus: 10 }
  } else if (ratio >= 1.5) {
    return { hasAdvantage: true, hasExtraTurn: false, extraTurnDamageBonus: 0 }
  }
  return { hasAdvantage: false, hasExtraTurn: false, extraTurnDamageBonus: 0 }
}
```

**强制规则：如果 `hasExtraTurn: true`，`gameLoop` 必须在同一个 tick 内执行两次 `processPlayerAttack`，不能只设标志位。**

#### 2.5.3 伤害数字飘字（DamagePopup）

```typescript
interface DamagePopupConfig {
  DURATION_MS: 800          // 飘字持续时间
  FLOAT_DISTANCE: 60        // 飘字上升距离 px
  CRIT_SCALE: 1.3           // 暴击时字体放大倍率
  CRIT_COLOR: '#e94560'    // 暴击时颜色
  TRUE_COLOR: '#ffd700'     // 真实伤害颜色
  VOID_COLOR: '#ff6b6b'    // 虚空伤害颜色
  NORMAL_COLOR: '#4ecdc4'   // 普通伤害颜色
}
```

### 2.6 装备和属性规范

#### 2.6.1 装备评分公式

```typescript
// 评分必须对所有稀有度有意义，不能被高稀有度碾压
function calculateEquipmentScore(eq: Equipment): number {
  let score = 0
  for (const stat of eq.stats) {
    const baseValue = BASE_STAT_VALUES[stat.type] ?? 10
    // 归一化后乘以稀有度系数
    score += (stat.value / baseValue) * RARITY_MULTIPLIER[eq.rarity] * 0.1
  }
  return Math.floor(score * 100)
}
```

#### 2.6.2 装备对比逻辑

```typescript
// 替换规则：
// 1. 新装备分数 > 当前装备分数 × 1.0 → 直接替换
// 2. 新装备分数 > 当前装备分数 × 1.2 → 提示用户确认
// 3. 新装备分数 ≤ 当前装备分数 → 不替换，给回收金币
```

### 2.7 UI/UX 规范

#### 2.7.1 战斗 HUD 布局

```
┌─────────────────────────────────────────────┐
│  [玩家名]  Lv.XX          [怪物名]  Lv.XX  │
│  ████████░░  HP           ████████░░  HP   │
│  [玩家血条]                 [怪物血条]       │
│  [行动槽████░░░]           [行动槽██░░░░]   │
├─────────────────────────────────────────────┤
│  [伤害飘字区域]                               │
├─────────────────────────────────────────────┤
│  [战斗日志 - 最近 5 条滚动]                   │
├─────────────────────────────────────────────┤
│  [技能1] [技能2] [技能3] [技能4] [技能5]     │
│  [普通攻击]              [暂停] [加速] [自动] │
└─────────────────────────────────────────────┘
```

#### 2.7.2 数值显示规范

```typescript
// ✅ 统一格式化函数
function formatNumber(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

// ✅ 百分比
function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + '%'  // 适用于 0-1 的小数
  // 或
  return n.toFixed(1) + '%'           // 适用于已经是百分比的数
}
```

#### 2.7.3 颜色规范

```typescript
// 所有颜色在 constants 文件里管理
export const COLORS = {
  // 伤害类型
  NORMAL_DAMAGE: '#4ecdc4',
  CRIT_DAMAGE: '#e94560',
  TRUE_DAMAGE: '#ffd700',
  VOID_DAMAGE: '#ff6b6b',

  // 装备稀有度
  RARITY: {
    common: '#9d9d9d',
    good: '#4dff4d',
    fine: '#4d9dff',
    epic: '#9d4dff',
    legend: '#ff9d4d',
    myth: '#ff4d9d',
    ancient: '#ffd700',
    eternal: '#00ffff'
  },

  // 状态
  HP_BAR: '#4ade80',
  HP_BAR_LOW: '#ef4444',
  GAUGE_FILL: '#60a5fa',

  // 文字
  TEXT_PRIMARY: '#f1f5f9',
  TEXT_SECONDARY: '#94a3b8'
} as const
```

### 2.8 数据持久化规范

#### 2.8.1 LocalStorage 结构

```typescript
// 所有 store 的 key 前缀统一
const SAVE_KEYS = {
  PLAYER: 'nz_player_v1',      // 玩家数据
  GAME:   'nz_game_v1',        // 游戏状态（战斗进度等）
  META:   'nz_meta_v1',        // 元数据（最后登录时间等）
} as const

// 保存时机：
// 1. 击杀怪物后
// 2. 切换 Tab 时
// 3. 升级/购买属性后
// 4. 装备变更后
// 5. 每 60 秒自动保存（心跳）
```

#### 2.8.2 存档版本迁移

```typescript
interface SaveDataV1 {
  version: 1
  player: PlayerData
  game: GameData
}

interface SaveDataV2 {
  version: 2
  player: PlayerData
  game: GameData
  achievements: AchievementData
}

function migrateSaveData(data: unknown): SaveDataV2 {
  const v = (data as any).version ?? 1
  if (v < 2) {
    // 迁移 V1 → V2
    ;(data as any).achievements = []
  }
  ;(data as any).version = 2
  return data as SaveDataV2
}
```

### 2.9 测试规范

#### 2.9.1 单元测试（calc.ts 等纯函数）

```typescript
// tests/calc.test.ts
import { describe, it, expect } from 'vitest'
import { calculateDamage } from '@/utils/calc'

describe('calculateDamage', () => {
  it('未命中时返回 0', () => {
    // mock 随机数
  })

  it('暴击伤害 = 基础伤害 × 暴击倍率', () => {
    const result = calculateDamage({ attack: 100, critRate: 100, critDamage: 200, ... }, {...})
    expect(result.isCrit).toBe(true)
    expect(result.finalDamage).toBe(200)
  })

  it('护甲减伤有下限，最多减免约 90%', () => {
    // defense → ∞ 时，reduction → 1
  })
})
```

#### 2.9.2 数值平衡测试

```typescript
// tests/numerical.test.ts
// 验证每个难度阶段，玩家攻击力成长能跟上怪物防御成长
it('difficulty=100 时，玩家的 effectiveDamage 应为正值', () => {
  const player = createPlayer(...)
  const monster = generateMonster(100)
  const damage = calculateDamage(player, monster)
  expect(damage.finalDamage).toBeGreaterThan(0)
})
```

---

## 三、当前问题优先级

| 优先级 | 问题 | 对应规范 |
|---|---|---|
| P0 | App.vue 臃肿（2600+ 行） | 重构成 Tab 组件，按功能拆分 |
| P0 | 暴击判定逻辑重复/不一致 | 抽取 `calculateCrit` 到 calc.ts |
| P0 | 速度优势 `hasExtraTurn` 未实现 | 2.5.2 节规范 |
| P1 | BUFF 系统数据设计缺陷 | 重构 BUFF 数据结构 |
| P1 | Combo 伤害未连接到战斗流程 | `getPlayerHitCount` 接入攻击循环 |
| P1 | 数值平衡（防御增长过快、抽奖成本爆炸） | 修复公式 + 添加测试 |
| P2 | `accuracy` 属性应用错误 | 按 2.4.1 节的命中公式修正 |
| P2 | `doLottery` 递归问题 | 改写成循环 |
| P3 | 伤害飘字缺失 | DamagePopup.vue 已存在但需接入 |
| P3 | 存档版本迁移机制缺失 | 2.8.2 节规范 |
