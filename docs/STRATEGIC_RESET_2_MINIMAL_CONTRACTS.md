# Strategic Reset 2 — 最小不可再分合同（Minimal Indivisible Contracts）

> 基线：INCREMENTAL_WORLD_RUNTIME_AUDIT.md（v2，战略批准）
> 日期：2026-08-08 · 性质：纯纸面设计，不写代码、不建 repo
> 目标：把新 Runtime 的最小合同定下来，用两个纸面 scenario 验证后，才允许创建新 repository

---

## 1. 范围与约束

- 本阶段只定义**最小不可再分合同**：9 个原语；
- 用两个纸面 scenario（A 生产 / B 战斗）逐事件走查；
- 出口条件：两个 scenario 完全不出现 `Miner-specific hack` / `Combat-specific scheduler` / `Renderer mutation simulation`，且无第二个实现路径；
- 期间禁止：写代码、建 repo、选渲染引擎、做美术。

---

## 2. 九个最小原语

### 2.1 SimulationTime（`SimTime`）

```
type SimTime = number   // 单调递增整数毫秒
```

- 语义：所有 gameplay 决策的唯一时间轴；与 wall clock 完全隔离；
- 所有权：Scheduler 推进；规则只读；
- 消费方：Action 时间边界、WorldEvent.t、ActionPhase 派生；
- 不变量：只增不减；**规则代码禁止 `Date.now()`**（wall clock 只在"决定离线时长"时进入）。

### 2.2 Entity

```
Entity {
  id: EntityId        // 全局唯一、跨存档稳定
  kind: EntityKind    // 'worker' | 'unit' | 'resourceNode' | 'storage' | 'projectile' | 'loot' | 'processor' | …
  position: Position
  state: EntityState  // 域扩展（hp/inventory/capacity/ore 等），由 gameplay 域 schema 定义
}
```

- 语义：世界中可标识、可被 action 指向/影响的参与者；
- 所有权：world 持有；rules 修改 state；renderer 只读；
- 不变量：实体只能经 `EntitySpawned` 出现、经 `EntityKilled` 消失（无静默增删）；id 不因保存/加载改变。

### 2.3 Position

```
Position { x: number, y: number }   // 世界坐标（float）
```

- 语义：唯一空间真相；距离检查、移动目标、弹道路径、掉落地点的唯一来源；
- 所有权：simulation 修改（产生 `EntityMoved` 事件）；renderer 消费做插值；
- 不变量：位置变化必须可经事件流重建（headless 与 replay 得到同一轨迹）。

### 2.4 Action

```
Action {
  id: ActionId
  actor: EntityId
  type: ActionType            // 'gather' | 'carry' | 'attack' | 'cast' | 'collect' | 'build' | …
  target: EntityId | Position | null
  startAt: SimTime            // 进入队列/开始的时刻
  reachAt: SimTime | null     // approach 结束（到达目标/进入射程）
  impactAt: SimTime | null    // 命中/产出发生的时刻
  finishAt: SimTime           // 可开始下一个 action 的时刻
}
```

- 语义：一个有时间边界的、actor 对 target 的可打断过程；**时间边界全部由规则计算**；
- 关键设计：Action 只携带时间边界，**不携带视觉参数**（抬手帧数/音效/特效归属 presentation）；
- 产出节奏（如 gather 每 1000ms 产 1、DoT 每 500ms 一跳）**不硬编码进 Action**——由规则在 `[impactAt, finishAt]` 区间注册 tick deadline 表达；
- 不变量：`startAt ≤ reachAt ≤ impactAt ≤ finishAt`（可相等：贴身攻击 reachAt==impactAt）。

### 2.5 ActionPhase（派生值，非独立状态）

```
phaseOf(action, t): 'queued' | 'approach' | 'windup' | 'active' | 'impact' | 'recovery' | 'complete' | 'cancelled'
```

- 语义：由 Action 时间边界与当前 `t` **计算得出**，无第二份真相：
  - t < startAt → queued
  - startAt ≤ t < reachAt → approach
  - reachAt ≤ t < impactAt → windup
  - t == impactAt → impact（瞬间）
  - impactAt < t < finishAt → 若产出区间有 tick → active；否则 → recovery
  - t ≥ finishAt → complete（等待移除）
- 消费方：presentation 动画状态机、headless 测试断言时序；
- 不变量：相同 `(action, t)` 永远得到相同 phase。

### 2.6 WorldEvent

```
WorldEvent {
  t: SimTime
  type: 'ActionStarted' | 'ActionFinished' | 'ActionCancelled'
      | 'EntitySpawned' | 'EntityKilled' | 'EntityMoved'
      | 'DamageApplied' | 'ResourceGained' | 'ResourceConsumed'
      | 'LootSpawned' | 'LootCollected' | 'UnlockOccurred' | …
  actor?: EntityId
  target?: EntityId
  position?: Position
  payload?: { amount?, item?, … }   // 域扩展
}
```

- 语义：**可渲染的语义事件**（红线：禁止 `damageEnemy(100)` 后让 UI 猜）；事件是不可变值对象，带模拟时间戳；
- 所有权：simulation 产出；renderer / UI / offline 聚合只消费；
- 不变量：事件流按 `t` 单调有序；**renderer 不产生事件**；事件是唯一跨层数据通道（规则与 presentation 之间无私有通道）。

### 2.7 WorldState（快照）

```
WorldState { t: SimTime, entities: Entity[], resources: Record<ResourceId, number> }
```

- 语义：世界在某时刻的完整可序列化快照；用途：headless 检查点、持久化、离线恢复、replay 种子；
- 不变量：`advance(world, until)` 是纯函数：`(state, until, seed) → { state', events }`，相同输入永远相同输出。

### 2.8 Scheduler

```
advance(world, until) → { world', events }        // real-time：短 until，逐 deadline
fastForward(world, until) → { world', events, summary }  // fast-forward：批量聚合，同一规则
```

- 内部：**deadline 队列**（`SimTime → handler`），事件驱动逐 deadline 推进（复用 combatClock 的"把所有系统推进到下一个时刻"思想，但不认识 gauge/player/monster）；
- 规则通过注册 deadline（ActionDeadline / MovementDeadline / ProductionTick）参与；scheduler 本身不感知 gameplay；
- 两种模式共享同一规则函数：real-time 产出完整事件流；fast-forward 跳过 presentation 事件、批量聚合（同 §审计 9）；
- 不变量：无 gameplay 分支；`advance` 与 `fastForward` 在同一初始状态+时长下聚合结果一致（对拍测试）。

### 2.9 Renderer contract

```
Renderer = {
  consume(events: WorldEvent[]): void     // 订阅语义事件 → 派生动画/特效/声音/摄像机
  render(world: WorldState, t: SimTime): void  // 可选：每帧呈现当前世界
}
```

- 语义：纯消费端；可从同一事件流派生像素/Canvas/Pixi/headless/Replay 视图；
- 不变量：**任何 renderer 实现都不影响 simulation 输出**；renderer 的插值/动画状态机只基于事件与 phase 派生。

---

## 3. 合同间数据流

```
gameplay 规则 --注册 deadline/修改 EntityState--> Scheduler
Scheduler --advance--> WorldState' + WorldEvent[]
WorldEvent[] --派生--> ActionPhase（供 renderer 与测试）
WorldEvent[] --消费--> Renderer / UI / Offline 聚合
WorldState --快照--> Persistence / Replay / 离线恢复
```

```
simulation state → semantic events → world state → renderer → visible action
（目标哲学原样落地：数值/状态变更永远先变成语义事件，再由 renderer 呈现）
```

---

## 4. Scenario A：矿工采矿 → 搬运（纸面走查）

### 4.1 实体

| id | kind | position | state（域扩展） |
|---|---|---|---|
| miner1 | worker | (2, 2) | inventory 0 / capacity 5 / moveSpeed 2 units/s |
| node_a | resourceNode | (8, 2) | ore 30 / yield 1 per 1000ms |
| storage_b | storage | (14, 2) | ore 0 |

### 4.2 规则（参数化）

- gather：approach 耗时 = 距离/speed；windup 400ms；产出 tick 1000ms（区间 [impactAt, finishAt]）；inventory 满 capacity 结束；
- carry：approach 至 storage；结束时清空 inventory 入 storage；随后自动排队下一个 gather。

### 4.3 事件流（首次循环，聚合）

```
t=0      ActionStarted    action=gather  actor=miner1 target=node_a
t=3000   (reachAt)  → phase approach→windup        [派生，无事件]
t=3400   (impactAt) → phase windup→active（tick 区间开始）
t=3400   ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=4400   ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=5400   ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=6400   ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=7400   ResourceGained  actor=miner1 source=node_a resource=ore amount=1   // inventory=5 满
t=7400   ActionFinished   action=gather  actor=miner1
t=7400   ActionStarted    action=carry   actor=miner1 target=storage_b
t=10400  ResourceConsumed actor=miner1 resource=ore amount=5
t=10400  ResourceGained   target=storage_b resource=ore amount=5
t=10400  ActionFinished   action=carry   actor=miner1
t=10400  ActionStarted    action=gather  actor=miner1 target=node_a        // 自动续
```

### 4.4 Presentation 派生示例（纯消费）

```
ActionStarted(gather)  → 走路动画，朝向 node_a
phase→windup           → 停走、举镐
ResourceGained(+1)     → 矿点闪一下 + 头顶 +1 飘字
ActionStarted(carry)   → 扛包走路
ResourceGained(storage)→ 仓库矿石堆叠 +1（可见增长）
```

### 4.5 可见瓶颈

- 矿点 ore 存量下降 → 矿点视觉缩小/颜色变浅（存量是 EntityState，renderer 读取渲染）；
- storage 满 → carry 无法存入：规则产出 `LootSpawned`（矿石掉地上）→ **地上可见堆积**（瓶颈可视化，无需任何数值面板）。

---

## 5. Scenario B：守卫接敌 → 攻击 → 击杀 → 掉落（纸面走查）

### 5.1 实体

| id | kind | position | state（域扩展） |
|---|---|---|---|
| hero1 | unit | (3, 3) | hp 100 / atk 10 / range 1.5 / moveSpeed 3 |
| slime3 | unit | (8, 8) | hp 30 / atk 5 / 巡逻 |
| loot_1 | loot | —（出生时定） | item iron_scrap |

### 5.2 规则（参数化）

- attack：approach 至射程；windup 200ms；impact 单点伤害；recovery 300ms；命中判定（命中/闪避/暴击）是 impact 时刻的规则决策，产出 `DamageApplied`；
- cast（技能）：windup 700ms → spawn projectile entity → 沿直线移动（MovementDeadline）→ 到达 → impact → 伤害；
- 击杀：hp ≤ 0 → `EntityKilled` + 延迟 60ms `LootSpawned`（掉落物实体，位置=死亡位置）；
- collect：loot 实体被拾取 → `LootCollected`。

### 5.3 事件流（聚合）

```
t=0      EntitySpawned  entity=slime3 position=(8,8)
t=1200   EntityMoved    entity=slime3 position=(7.6,7.6)     // 巡逻
t=5000   ActionStarted  action=attack actor=hero1 target=slime3
t=5600   (reachAt) → phase approach→windup                   [派生]
t=5800   AttackImpact   actor=hero1 target=slime3
t=5800   DamageApplied  source=hero1 target=slime3 amount=27
t=5800   EntityKilled   entity=slime3
t=5860   LootSpawned    item=iron_scrap position=(8.0,8.0)
t=6300   ActionFinished action=attack actor=hero1
t=6400   ActionStarted  action=collect actor=hero1 target=loot_1
t=7000   LootCollected  item=iron_scrap actor=hero1
```

（火球技能示例：`EntitySpawned kind=projectile` → 若干 `EntityMoved` → 到达时 `AttackImpact + DamageApplied + EntityKilled(projectile)`——与普攻共享同一事件语义。）

### 5.4 Presentation 派生示例（纯消费）

```
EntitySpawned(slime) → 怪物出现在世界
EntityMoved         → 移动补间（走路）
ActionStarted(attack) → 接近（approach 可见移动）
phase→windup        → 挥剑前摇
AttackImpact        → 刀光
DamageApplied       → 飘字 + 受击闪光/震屏
EntityKilled        → 死亡动画 → 消失
LootSpawned         → 地面物品出现
ActionStarted(collect) → 弯腰拾取 → LootCollected → 物品消失
```

### 5.5 可见瓶颈（战斗侧）

- 移动慢 → approach 阶段明显拉长（大量时间花在接敌）；清怪快但拾取慢 → 地上掉落越积越多——与生产侧"仓库满掉地上"是**同一类**世界可见瓶颈。

---

## 6. 交叉验证：无 hack 检查清单

| 检查项 | Scenario A | Scenario B | 结论 |
|---|---|---|---|
| Entity / Position / Target | miner 走向 node，target=EntityId | hero 走向 slime，target=EntityId；弹道 target=Position | 同一原语 ✓ |
| Action 时间边界 | gather/carry（startAt/reachAt/impactAt/finishAt） | attack/collect/cast（同结构） | 同一结构 ✓ |
| ActionPhase 派生 | approach→windup→active→complete（impact 为 tick 区间起点） | approach→windup→impact→recovery→complete | 同一 `phaseOf(action, t)` ✓（A 的"active"= B 的"recovery"区间内挂了 tick deadline，不是新阶段） |
| Scheduler | 移动 deadline + gather tick deadline + carry deadline | 移动 deadline + attack deadline + 弹道 deadline | **同一 scheduler，无 combat/gather 分支** ✓ |
| 产出/伤害 | ResourceGained（规则 tick） | DamageApplied（impact 单点） | 都是"规则在 deadline 上决策并产出事件"，非 scheduler 职责 ✓ |
| Renderer | 走路/挥镐/飘字/仓库堆叠/地面堆积 | 走路/挥剑/刀光/死亡/掉落/拾取 | 纯订阅，零 mutation ✓ |
| 域扩展位置 | inventory/capacity/ore 在 EntityState | hp/atk/range 在 EntityState | 状态在域 schema，不在 runtime 原语 ✓ |
| 打断语义 | （未走查，见 §7） | 死亡时取消活跃 Action → ActionCancelled | 同一机制 ✓ |

**结论：纸面走查未出现 Miner-specific hack、Combat-specific scheduler、Renderer mutation simulation。**

---

## 7. 边界情况（纸面预答）

| 边界 | 处理 | 归属 |
|---|---|---|
| actor 死亡/被移除 | 规则取消其所有活跃 Action → `ActionCancelled` 事件 → renderer 播放中断 | 规则 + Scheduler |
| target 消失 | 规则重选目标或取消（ActionCancelled） | 规则 |
| 排队 | Action 有 queued 阶段；Scheduler 只激活队首 | Scheduler（通用） |
| 时间边界相等 | reachAt==impactAt（贴身攻击）合法，phase 计算允许零长区间 | 派生函数 |
| fast-forward 批量 | 跳过 tick 事件，聚合为 summary（同规则，`cycles = floor(Δt/cycle)`） | Scheduler fastForward |
| 事件量上限 | 单帧 deadline 预算（继承 MAX_LOGIC_EVENTS_PER_FRAME 思想，不饥饿） | Scheduler |
| 离线死亡 | fast-forward 中单位死亡必须被判定（不因批量而跳过） | 规则（对拍测试保证） |
| 掉落物永久堆积 | loot 实体有寿命/上限（规则参数），或成为可见瓶颈的正当来源 | 规则 |

---

## 8. 不变式总清单（写代码前的红线）

1. `SimTime` 只增不减；规则禁止 `Date.now()`；
2. Entity 只能经 Spawned/Killed 事件增删；id 跨存档稳定；
3. Action 时间边界由规则计算；Action 不携带视觉参数；
4. ActionPhase 是 `phaseOf(action, t)` 派生值，无独立存储；
5. 事件流按 t 单调有序、不可变；renderer 不产生事件；
6. `advance` / `fastForward` 是纯函数：同输入+同 seed → 同输出；
7. Scheduler 无 gameplay 分支（不知道 gather/attack/gauge）；
8. 任何 renderer 实现不影响 simulation 输出；
9. 语义事件是跨层唯一数据通道（无规则↔presentation 私有通道）；
10. 产出节奏（tick/DoT）是规则注册的 deadline，不硬编码进 Action 结构。

---

## 9. 创建新 repository 的准入门（Exit criteria）

只有以下全部成立，才允许建 `incremental-world-runtime` 仓库：

1. [ ] 本合同的 9 原语 + 10 不变式冻结（可小幅命名调整，语义不变）；
2. [ ] 两个 scenario 的纸面走查无 hack（§6 表格全 ✓）；
3. [ ] 首个实现计划 = **纯 TS headless**：Scheduler + 两个规则域的最小 smoke（gather 一轮 + attack 一轮，断言事件流与 phase 序列）——即 R0/R1 合一；
4. [ ] 在此之前不选择渲染引擎、不写 Vue/Canvas/Pixi 代码；
5. [ ] 旧仓库保持 FROZEN（`5c29e83`），零触碰。

---

*本文件为纸面设计，未写任何代码、未创建任何仓库、未修改旧产品线。*
