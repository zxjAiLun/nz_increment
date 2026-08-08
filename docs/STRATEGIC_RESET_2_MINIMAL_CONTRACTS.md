# Strategic Reset 2 — 最小不可再分合同（Minimal Indivisible Contracts）

> 基线：INCREMENTAL_WORLD_RUNTIME_AUDIT.md（v2，战略批准）
> 版本：v2.1（Strategic Reset 2 Repair 2 — Action Temporal Boundary Closure）
> 日期：2026-08-08 · 性质：纯纸面设计，不写代码、不建 repo、不选渲染引擎
> 目标：把新 Runtime 的最小合同定下来，用两个纸面 scenario 验证后，才允许创建新 repository
>
> **v2 修订记录（Repair 1，吸收 5 P1 + 2 P2）**：
> 1. Entity 生命周期泛化：`EntitySpawned / EntityDespawned` 为 world 原语；`EntityKilled` 降为 combat semantic，不再承担通用删除；
> 2. Action 增加 `activeUntil` / `cancelledAt?`，`phaseOf(action, t)` 真正纯派生；
> 3. WorldState 补全为可恢复快照（actions / deadlines / rng / seq / domain）；
> 4. Scheduler deadline 为纯数据 `(at, ordinal, kind, owner, payload)`，kind→纯规则注册表；
> 5. RNG 连续性：`RngState { seed, cursor }` 属于 snapshot，分段/整段 advance 对拍等价；
> 6. 同 SimTime 确定性总序：deadline `(at, ordinal)`、事件 `(t, seq)`；
> 7. R0/R1 移动语义收口：approach 冻结 destination，`positionAt(t)` 可确定，动态目标 cancel/replan，无 pathfinding/碰撞；
> 8. 事件与快照双通道：Presentation 只消费 immutable snapshot + immutable ordered event stream；
> 9. Fast-forward 不省略 gameplay state transition，对拍目标为语义等价；
> 10. 删除 `WorldState.resources` 双重真相源：空间/本地资源唯一权威在 entity/domain state；
> 11. 两个 scenario 重走查 + 两个 deterministic edge cases（中途存档 / 同刻双 deadline）；
> 12. 文档元数据更新为已发布状态。
>
> **v2.1 修订记录（Repair 2，Action Temporal Boundary Closure）**：
> 1. Action 时间边界全部为数值（移除 nullable）：缺失阶段用零长度区间表达（`startAt==reachAt` / `reachAt==impactAt` / `impactAt==activeUntil` / `activeUntil==finishAt`）；
> 2. `phaseOf(action, t)` 约定为「该 timestamp 所有 deadline 处理完后的稳定 phase」，terminal state 优先（cancelled → complete → …）；
> 3. 取消边界冻结：`cancelledAt < finishAt` 才为有效取消；已完成 action 不得转为 cancelled；同一 timestamp 的 finish/death/cancel 由 `(at, ordinal)` + domain rule 决定唯一 terminal interpretation；
> 4. `Entity.position` 明确为「最近一次 committed spatial anchor」；`positionAt(world, entity, t)` 是 gameplay 获取当前位置的唯一公开查询；到达 `reachAt` 提交 `approachTo`；
> 5. 四个示例 action 的 phase 时间线重查，零长度阶段全部有确定结果；
> 6. 文档元数据更新（Repair 1 baseline: `240ee111`）。

---

## 1. 范围与约束

- 本阶段只定义**最小不可再分合同**：9 个核心原语 + 2 个配套原语（RngState、ScheduledDeadline）；
- 用两个纸面 scenario（A 生产 / B 战斗）逐事件走查，并验证两个 deterministic edge cases；
- 出口条件：两个 scenario 完全不出现 `Miner-specific hack` / `Combat-specific scheduler` / `Renderer mutation simulation`，且无第二个实现路径；
- 期间禁止：写代码、建 repo、选渲染引擎、做美术、修改旧产品线。

---

## 2. 核心原语

### 2.1 SimulationTime（`SimTime`）

```
type SimTime = number   // 单调递增整数毫秒
```

- 语义：所有 gameplay 决策的唯一时间轴；与 wall clock 完全隔离；
- 所有权：Scheduler 推进；规则只读；
- 消费方：Action 时间边界、WorldEvent.t、ActionPhase 派生、deadline.at；
- 不变量：只增不减；**规则代码禁止 `Date.now()`**（wall clock 只在"决定离线时长"时进入，且仅换算为 SimTime 增量）。

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
- **生命周期（v2 泛化）**：实体只能经 `EntitySpawned` 进入世界、经 **`EntityDespawned`** 离开世界（world lifecycle 原语）；`EntityKilled` 是 **combat semantic event**，不承担通用删除：
  - combat kill：`DamageApplied → EntityKilled → EntityDespawned`（EntityDespawned 可立即，也可在死亡动画后由 presentation 消费端决定呈现时长——注意：**呈现延时不进入 simulation**，simulation 的 EntityDespawned 时刻即世界事实）；
  - loot collection：`LootCollected → EntityDespawned(loot)`；
  - projectile：`ProjectileImpact（或等效语义事件）→ EntityDespawned(projectile)`；
  - **禁止用 `EntityKilled` 表示非生命对象回收**（矿石被挖空、弹道消散、临时 FX 实体一律走 Despawned）；
- 不变量：id 不因保存/加载改变；无静默增删。

### 2.3 Position 与移动语义（R0/R1 收口）

```
Position { x: number, y: number }   // 世界坐标（float）
```

- 语义：唯一空间真相；距离检查、移动目标、弹道路径、掉落地点的唯一来源；
- 所有权：simulation 修改（产生 `EntityMoved` 事件）；renderer 消费做插值；
- 不变量：位置变化必须可经事件流重建（headless 与 replay 得到同一轨迹）。

**Position 查询约定（v2.1）**：

- `Entity.position` 是**最近一次 committed spatial anchor**（上一次位置提交时刻的坐标），不是实时插值位置；
- `positionAt(world, entity, t)` 是 gameplay 查询某时刻位置的**唯一公开入口**（纯函数）：
  - 无 active motion segment → 返回 `Entity.position`；
  - 有 active approach motion segment → 从 `(approachFrom, approachTo, t)` 线性插值派生；
- 到达 `reachAt` 时 simulation 提交 `Entity.position = approachTo` 并移除该 motion segment（同时产出 `EntityMoved` 事件）；
- Renderer 可以使用同一纯函数插值，但**不得维护第二份 gameplay position**；
- 这样 save/reload 在移动途中也不会出现两套当前坐标（快照存 anchor + motion segment，恢复后 `positionAt` 继续确定）。

**R0/R1 移动支持范围（收口，不扩张为 pathfinding/physics 项目）**：

- Action 创建时**冻结 approach destination**：Action 携带 `approachFrom` / `approachTo`（serializable motion segment）；
- `positionAt(world, entity, t)` 对 approach 中的 actor 由 motion segment **确定性计算**（线性插值，纯函数）；
- 目标在 approach 期间移动 → 当前 action 触发 **cancel/replan**（规则决策，产出 `ActionCancelled`）；
- R0/R1 **不支持**：continuous collision、navigation mesh、dynamic interception（弹道追踪移动目标）；
- 静态目标（矿点/仓库）与"到达后按冻结位置执行"是本阶段唯一保证。

### 2.4 Action（v2.1：全数值时间边界，无 nullable）

```
Action {
  id: ActionId
  actor: EntityId
  type: ActionType            // 'gather' | 'carry' | 'attack' | 'cast' | 'collect' | 'build' | …
  target: EntityId | Position | null
  startAt: SimTime            // 进入队列/开始的时刻
  reachAt: SimTime            // approach 结束（到达目标/进入射程）
  impactAt: SimTime           // 命中/首次产出的时刻
  activeUntil: SimTime        // gameplay active window 结束（产出/DoT 区间终点）
  finishAt: SimTime           // 可开始下一个 action 的时刻
  cancelledAt?: SimTime       // 被取消的时刻（未取消则不设置）
  approachFrom?: Position     // R0/R1：创建时冻结的移动起点
  approachTo?: Position       // R0/R1：创建时冻结的移动终点（approach destination）
}
```

- 语义：一个有时间边界的、actor 对 target 的可打断过程；**所有时间边界由规则计算，全部为数值**；
- **R0/R1 不使用 `null` 表达缺失阶段**——缺失阶段统一用**零长度区间**：
  - no approach → `startAt == reachAt`
  - no windup → `reachAt == impactAt`
  - instant hit → `impactAt == activeUntil`
  - no recovery → `activeUntil == finishAt`
  - 不变量：`startAt ≤ reachAt ≤ impactAt ≤ activeUntil ≤ finishAt`（全部可相等）；
- **`activeUntil` 是 gameplay 语义，不是视觉参数**：
  - 挥剑（单点命中）：`impactAt = 1000, activeUntil = 1000, finishAt = 1300`；
  - 采矿（持续产出）：`impactAt = 1000, activeUntil = 6000, finishAt = 6000`；
  - 视觉参数（抬手帧数/剑光时长/震屏强度/脚步频率）**一律禁止进入 Action**，由 presentation 从时间边界派生；
- 产出节奏（gather 每 1000ms 产 1、DoT 每 500ms 一跳）**不硬编码进 Action**——由规则在 `(impactAt, activeUntil]` 区间注册 tick deadline 表达。

### 2.5 ActionPhase（派生值，非独立状态；v2.1：terminal-first 稳定 phase）

```
phaseOf(action, t): 'cancelled' | 'complete' | 'queued' | 'approach' | 'windup' | 'impact' | 'active' | 'recovery'
```

- 语义：**simulation 已处理完 timestamp `t` 上所有按 `(at, ordinal)` 排定的 deadline 之后**，该 Action 的稳定 phase；
- 同一 timestamp 内的瞬时事实（`ResourceGained` / `AttackImpact` / `ActionFinished`）由 ordered `WorldEvent (t, seq)` 表达——**不要求 `phaseOf` 同时保存它们**（两套语义不打架）；
- **terminal state 优先**（严格按序判定）：

```
cancelledAt 存在 且 cancelledAt < finishAt 且 t ≥ cancelledAt   → cancelled

t ≥ finishAt                                                  → complete

t < startAt                                                  → queued
startAt ≤ t < reachAt                                        → approach
reachAt ≤ t < impactAt                                       → windup
t == impactAt 且 impactAt < finishAt                         → impact
impactAt < t < activeUntil                                   → active
activeUntil ≤ t < finishAt                                   → recovery
```

- **取消边界**：`cancelledAt < finishAt` 才为有效取消；已完成（t ≥ finishAt）的 Action 不得随后转为 cancelled；同一 timestamp 的 finish/death/cancel 冲突由 `(at, ordinal)` + domain rule 决定，但最终 Action 只能有一个 terminal interpretation（默认约定：同时刻取消不生效，完成优先）；
- 零长度阶段均有确定结果：
  - `startAt == reachAt` → approach 区间为空，直接 windup；
  - `reachAt == impactAt` → windup 区间为空；
  - `impactAt == activeUntil` → impact 后直接 recovery（active 区间为空）；
  - `activeUntil == finishAt` → recovery 区间为空（active 直到完成）；
  - `impactAt == finishAt` → 该时刻为 complete（impact 判定要求 `impactAt < finishAt`）；
- 必达断言（Repair 2 合同测试）：`phaseOf(gather1, 7400) == complete`、`phaseOf(carry1, 10400) == complete`（即使同 timestamp 此前发生过 ResourceGained / ActionFinished 事件）；
- 消费方：presentation 动画状态机、headless 测试断言时序；
- 不变量：相同 `(action, t)` 永远得到相同 phase——**不依赖任何外部注册表/调度器查询**。

### 2.6 WorldEvent

```
WorldEvent {
  t: SimTime
  seq: number               // 确定性序号：同 t 内严格递增（v2）
  type: 'ActionStarted' | 'ActionFinished' | 'ActionCancelled'
      | 'EntitySpawned' | 'EntityDespawned' | 'EntityMoved' | 'EntityKilled' | 'ProjectileImpact'
      | 'DamageApplied' | 'ResourceGained' | 'ResourceConsumed'
      | 'LootSpawned' | 'LootCollected' | 'UnlockOccurred' | …
  actor?: EntityId
  target?: EntityId
  position?: Position
  payload?: { amount?, item?, … }   // 域扩展
}
```

- 语义：**可渲染的语义事件**（红线：禁止 `damageEnemy(100)` 后让 UI 猜）；事件是不可变值对象；
- **`(t, seq)` 构成 deterministic total order**：同 t 的事件按 seq 严格有序，seq 由 Scheduler 确定性分配（同 t 的注册/执行顺序决定）；
- 所有权：simulation 产出；presentation / UI / offline 聚合只消费；
- 不变量：事件流按 `(t, seq)` 全序；**renderer 不产生事件**；`EntityKilled` 仅表 combat 击杀语义，删除语义一律走 `EntityDespawned`。

### 2.7 WorldState（完整可恢复快照，v2 补全）

```
WorldState {
  t: SimTime
  entities: Entity[]
  actions: Action[]                     // active + queued（含全部时间边界）
  deadlines: ScheduledDeadline[]        // 可序列化的 scheduler 队列
  rng: RngState                         // RNG 当前状态/游标
  seq: number                           // 确定性序号计数器（事件/动作/deadline 分配）
  domain: Record<string, unknown>       // 域账本/扩展（若域需要；R0/R1 默认可为空）
}
```

- 语义：**deterministic continuation 所需的完整状态**——在"挥剑前摇做到一半"存档，恢复后必须能继续同一个未来 deadline 序列（impact 时刻、后续 tick、RNG 消费位置全部不变）；
- **明确禁止放入 simulation snapshot**：deadline closure、browser callback、renderer 状态、wall clock、任何非序列化句柄；
- 资源真相（v2）：**删除 `resources: Record<ResourceId, number>` 全局账本**——空间/本地资源（node.ore、storage.ore、worker.inventory、loot 实体）唯一权威在 entity/domain state；若未来需要 global/meta ledger（如全服总量），必须独立语义且不得与实体计数构成双重真相；
- 不变量：`advance(world, until)` 是纯函数：`(state, until) → { state', events }`，相同输入永远相同输出（RNG 连续性见 2.10）。

### 2.8 Scheduler 与可序列化 Deadline（v2）

```
ScheduledDeadline {
  id: DeadlineId
  at: SimTime
  ordinal: number           // 同 at 的稳定 tie-break（注册顺序递增）
  kind: DeadlineKind        // 纯数据标签：'action.impact' | 'movement' | 'production.tick' | 'loot.spawn' | …
  owner: EntityId | ActionId | null
  payload: unknown          // 可序列化数据（规则自定义，禁止函数/closure）
}
```

- 执行：`advance(world, until)` 按 `(at, ordinal)` 全序逐 deadline 推进（复用 combatClock"把所有系统推进到下一个时刻"的思想，但不认识 gauge/player/monster/attack/gather）；
- **kind → rule reducer**：`kind` 到纯函数处理器的注册表由 **gameplay rule registry** 提供；Scheduler 本身零 gameplay 分支；
- **禁止 deadline closure**：deadline 是纯数据，保存/加载中途 Action 后必须能继续同一个未来 deadline 序列；
- 同 t 冲突（如 A 与 B 同时在 t=5000 impact）：Scheduler 只提供 `(at, ordinal)` 稳定执行顺序；"死亡是否阻止同刻反击"等业务结果由 combat/production domain 规则明确，Scheduler 不猜；
- 两种模式（同规则）：
  - `advance(world, until)`：real-time，短 until，逐 deadline，产出完整事件流；
  - `fastForward(world, until)`：批量推进，**可省略/聚合 observational event materialization，但绝不省略 gameplay state transition**（详见 §9）；
- 不变量：无 gameplay 分支；deadline 全可序列化；`advance` 与 `fastForward` 在同一初始状态+时长下**最终语义等价**（对拍测试）。

### 2.9 Renderer contract（v2 修订：事件 + 快照双通道）

```
Renderer = {
  consume(events: WorldEvent[]): void     // 订阅语义事件流 → 派生动画/特效/声音/摄像机
  render(world: WorldState, t: SimTime): void  // 呈现当前不可变世界快照
}
```

- **Presentation 只消费两类输入**：
  1. immutable `WorldState` snapshot（表达 **what is true now**——当前是什么）；
  2. immutable ordered `WorldEvent` stream（表达 **what happened**——发生了什么）；
- **禁止**：presentation → mutate simulation；presentation → 调用 simulation/gameplay 私有 API；presentation → 产生事件；
- 可从同一事件流派生像素/Canvas/Pixi/headless/Replay 视图；
- 不变量：**任何 renderer 实现都不影响 simulation 输出**；renderer 的插值/动画状态机只基于 snapshot 与事件流派生。

### 2.10 RngState（配套原语，v2 新增）

```
RngState { seed: number, cursor: number }   // 或具体 PRNG 的序列化内部状态
```

- 语义：RNG 的**当前状态/游标属于 simulation snapshot**，随 WorldState 一起保存/恢复；
- **连续性合同（对拍必须通过）**：

```
advance(A, 0→10s)                    ≡  advance(A, 0→5s) + advance(A', 5→10s)
   final world 一致
   RNG state 一致
   event/summary semantics 一致
```

- 禁止每次 `advance()` 从裸 seed 重新初始化（会重复消费随机流）；也禁止游标藏在函数外（破坏纯函数与可序列化）；
- 影响面：掉落、暴击、命中、采集随机产物、离线 fast-forward——全部依赖此合同。

---

## 3. 合同间数据流

```
gameplay 规则 --注册纯数据 deadline / 修改 EntityState--> Scheduler
Scheduler --advance (at,ordinal) 全序--> WorldState' + WorldEvent[]（(t,seq) 全序）
WorldEvent[] --派生--> ActionPhase（供 renderer 与测试）
WorldState --快照--> Persistence / Replay / 离线恢复（含 actions/deadlines/rng/seq）
Renderer --只消费--> WorldEvent[]（what happened）+ WorldState（what is true now）
```

```
simulation state → semantic events → world state → renderer → visible action
（目标哲学原样落地：数值/状态变更永远先变成语义事件，再由 renderer 呈现）
```

---

## 4. Scenario A：矿工采矿 → 搬运（纸面走查 v2）

### 4.1 实体

| id | kind | position | state（域扩展） |
|---|---|---|---|
| miner1 | worker | (2, 2) | inventory 0 / capacity 5 / moveSpeed 2 units/s |
| node_a | resourceNode | (8, 2) | ore 30 / yield 1 per 1000ms |
| storage_b | storage | (14, 2) | ore 0 |

### 4.2 Action 实例（v2 时间边界）

```
gather1: { actor: miner1, target: node_a,
           startAt: 0, reachAt: 3000, impactAt: 3400, activeUntil: 7400, finishAt: 7400,
           approachFrom: (2,2), approachTo: (8,2) }
carry1:  { actor: miner1, target: storage_b,
           startAt: 7400, reachAt: 10400, impactAt: 10400, activeUntil: 10400, finishAt: 10400,
           approachFrom: (8,2), approachTo: (14,2) }
```

- gather：产出 tick 由规则在 `(3400, 7400]` 注册（每 1000ms 一个 `production.tick` deadline）；inventory 满 capacity → 规则在最后一次产出的 tick 决定 finishAt=7400（finishAt 在 action 创建时按"满载所需 tick 数"计算，或由规则在满包时提前取消——两者都是规则决策，phase 派生不受影响）；
- 满载前若节点枯竭（ore 0）→ 规则取消 gather 并 replan（`ActionCancelled` + 新 action）。

### 4.3 事件流（首次循环，含 seq）

```
t=0      seq=1  ActionStarted    action=gather  actor=miner1 target=node_a
t=3000   (reachAt)  → phase approach→windup        [派生，无事件]
t=3400   (impactAt) → phase windup→active          [派生]
t=3400   seq=2  ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=4400   seq=3  ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=5400   seq=4  ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=6400   seq=5  ResourceGained  actor=miner1 source=node_a resource=ore amount=1
t=7400   seq=6  ResourceGained  actor=miner1 source=node_a resource=ore amount=1   // inventory=5 满
t=7400   seq=7  ActionFinished   action=gather  actor=miner1
t=7400   seq=8  ActionStarted    action=carry   actor=miner1 target=storage_b
t=10400  seq=9  ResourceConsumed actor=miner1 resource=ore amount=5
t=10400  seq=10 ResourceGained   target=storage_b resource=ore amount=5
t=10400  seq=11 ActionFinished   action=carry   actor=miner1
t=10400  seq=12 ActionStarted    action=gather  actor=miner1 target=node_a        // 自动续
```

### 4.4 Presentation 派生示例（纯消费）

```
ActionStarted(gather)  → 走路动画，朝向 node_a（approach 插值基于 approachFrom/To 与 phase）
phase→windup           → 停走、举镐
ResourceGained(+1)     → 矿点闪一下 + 头顶 +1 飘字
ActionStarted(carry)   → 扛包走路
ResourceGained(storage)→ 仓库矿石堆叠 +1（可见增长）
```

### 4.5 可见瓶颈

- 矿点 ore 存量下降 → 矿点视觉缩小/颜色变浅（存量是 EntityState，renderer 读取渲染）；
- storage 满 → carry 无法存入：规则产出 `LootSpawned`（矿石以 loot 实体掉地上，`EntitySpawned(loot)`）→ **地上可见堆积**（瓶颈可视化，无需任何数值面板）。

---

## 5. Scenario B：守卫接敌 → 攻击 → 击杀 → 掉落（纸面走查 v2）

### 5.1 实体

| id | kind | position | state（域扩展） |
|---|---|---|---|
| hero1 | unit | (3, 3) | hp 100 / atk 10 / range 1.5 / moveSpeed 3 |
| slime3 | unit | (8, 8) | hp 30 / atk 5 / 巡逻 |
| loot_1 | loot | —（出生时定） | item iron_scrap |

### 5.2 Action 实例（v2 时间边界）

```
attack1: { actor: hero1, target: slime3,
           startAt: 5000, reachAt: 5600, impactAt: 5800, activeUntil: 5800, finishAt: 6300,
           approachFrom: (3,3), approachTo: (7.5, 7.5) }   // approach 冻结终点=射程边缘
cast1:   { actor: hero1, target: position,
           startAt: 7000, reachAt: 7000, impactAt: 7700, activeUntil: 7700, finishAt: 8000 }   // 技能：windup 700ms → 弹道实体
```

- attack：windup 200ms（5600–5800）；impact 单点（命中/闪避/暴击判定在 impact 时刻的规则决策，产出 `DamageApplied`）；recovery 500ms（5800–6300）；
- cast：windup 700ms → `EntitySpawned(projectile)` + 弹道移动（MovementDeadline 序列）→ 到达时 `ProjectileImpact + DamageApplied` → `EntityDespawned(projectile)`；
- 击杀：hp ≤ 0 → `EntityKilled`（combat semantic）→ `EntityDespawned`（world lifecycle，simulation 立即移除；死亡动画时长由 presentation 消费端派生，不影响 simulation）；
- collect：loot 实体被拾取 → `LootCollected → EntityDespawned(loot)`。

### 5.3 事件流（聚合，含 seq）

```
t=0      seq=1  EntitySpawned    entity=slime3 position=(8,8)
t=1200   seq=2  EntityMoved      entity=slime3 position=(7.6,7.6)     // 巡逻
t=5000   seq=3  ActionStarted    action=attack actor=hero1 target=slime3
t=5600   (reachAt) → phase approach→windup                            [派生]
t=5800   seq=4  AttackImpact     actor=hero1 target=slime3
t=5800   seq=5  DamageApplied    source=hero1 target=slime3 amount=27
t=5800   seq=6  EntityKilled     entity=slime3                        // combat semantic
t=5800   seq=7  EntityDespawned  entity=slime3                        // world lifecycle
t=5860   seq=8  EntitySpawned    entity=loot_1 position=(8.0,8.0) item=iron_scrap
t=5860   seq=9  LootSpawned      item=iron_scrap position=(8.0,8.0)
t=6300   seq=10 ActionFinished   action=attack actor=hero1
t=6400   seq=11 ActionStarted    action=collect actor=hero1 target=loot_1
t=7000   seq=12 LootCollected    item=iron_scrap actor=hero1
t=7000   seq=13 EntityDespawned  entity=loot_1
```

### 5.4 Presentation 派生示例（纯消费）

```
EntitySpawned(slime)    → 怪物出现在世界
EntityMoved            → 移动补间（走路）
ActionStarted(attack)  → 接近（approach 可见移动）
phase→windup           → 挥剑前摇
AttackImpact           → 刀光
DamageApplied          → 飘字 + 受击闪光/震屏
EntityKilled           → 死亡动画（时长由 presentation 决定，simulation 已 Despawned）
LootSpawned            → 地面物品出现
ActionStarted(collect) → 弯腰拾取 → LootCollected + EntityDespawned(loot) → 物品消失
```

### 5.5 可见瓶颈（战斗侧）

- 移动慢 → approach 阶段明显拉长（大量时间花在接敌）；清怪快但拾取慢 → 地上掉落越积越多——与生产侧"仓库满掉地上"是**同一类**世界可见瓶颈。

### 5.6 Phase 时间线断言（v2.1：四个示例 action 全覆盖，无重叠/无无定义区间）

| t 区间 | gather1（0/3000/3400/7400/7400） | carry1（7400/10400/10400/10400/10400） | attack1（5000/5600/5800/5800/6300） | cast1（7000/7000/7700/7700/8000） |
|---|---|---|---|---|
| before start（t < startAt） | queued | queued | queued | queued |
| during approach（[startAt, reachAt)） | approach | approach | approach | —（startAt==reachAt → 直接 windup） |
| during windup（[reachAt, impactAt)） | windup | —（reachAt==impactAt） | windup | windup |
| at impact（t==impactAt 且 impactAt<finishAt） | impact | —（impactAt==finishAt → complete） | impact | impact |
| during active（(impactAt, activeUntil)） | active（3400–7400 逐 tick 产出） | —（activeUntil==impactAt） | —（activeUntil==impactAt） | —（activeUntil==impactAt） |
| during recovery（[activeUntil, finishAt)） | —（activeUntil==finishAt） | —（activeUntil==finishAt） | recovery（5800–6300） | recovery（7700–8000） |
| at finish（t≥finishAt） | complete（含 t=7400） | complete（含 t=10400） | complete（含 t=6300） | complete（含 t=8000） |

- 每个 t 恰好命中一个 phase（判定序唯一：cancelled → complete → queued → approach → windup → impact → active → recovery）；
- 零长度阶段（— 单元格）由相邻判定吸收，无"无定义区间"：
  - `startAt==reachAt`（cast1）：无 approach；
  - `reachAt==impactAt`（carry1）：无 windup；
  - `impactAt==activeUntil`（carry1/attack1/cast1）：无 active（impact 后直接 recovery 或 complete）；
  - `activeUntil==finishAt`（gather1/carry1）：无 recovery；
  - `impactAt==finishAt`（carry1）：该时刻直接 complete（impact 判定要求 `impactAt < finishAt`）；
- 必达断言：`phaseOf(gather1, 7400) == complete`、`phaseOf(carry1, 10400) == complete`。

---

## 6. 交叉验证：无 hack 检查清单（v2）

| 检查项 | Scenario A | Scenario B | 结论 |
|---|---|---|---|
| Entity / Position / Target | miner 走向 node，target=EntityId；approach 冻结 | hero 走向 slime，target=EntityId；弹道 target=Position | 同一原语 ✓ |
| Action 时间边界 | gather/carry（startAt/reachAt/impactAt/activeUntil/finishAt） | attack/collect/cast（同结构） | 同一结构 ✓ |
| ActionPhase 派生 | approach→windup→impact→active→complete（activeUntil=finishAt） | approach→windup→impact→recovery→complete（activeUntil=impactAt） | 同一 `phaseOf(action, t)`，零外部依赖 ✓ |
| 生命周期事件 | gather 结束=ActionFinished；loot 掉地=EntitySpawned+Despawned | 击杀=EntityKilled+EntityDespawned；弹道=ProjectileImpact+Despawned | 同一 world lifecycle 原语 ✓ |
| Scheduler | 移动/生产 tick/carry deadline | 移动/impact/弹道 deadline | **同一 scheduler，无 combat/gather 分支** ✓ |
| 产出/伤害 | ResourceGained（规则 tick） | DamageApplied（impact 单点） | 都是"规则在 deadline 上决策并产出事件"，非 scheduler 职责 ✓ |
| Renderer | 走路/挥镐/飘字/仓库堆叠/地面堆积 | 走路/挥剑/刀光/死亡/掉落/拾取 | 纯消费 snapshot + 事件流，零 mutation ✓ |
| 域扩展位置 | inventory/capacity/ore 在 EntityState | hp/atk/range 在 EntityState | 状态在域 schema，不在 runtime 原语 ✓ |
| 确定性顺序 | 同 t 事件按 seq 有序 | 同 t 事件按 seq 有序 | (t, seq) 全序 ✓ |
| 打断语义 | （见 §7 edge case） | 死亡时取消活跃 Action → ActionCancelled | 同一机制 ✓ |

**结论：纸面走查未出现 Miner-specific hack、Combat-specific scheduler、Renderer mutation simulation；两域共享同一 world lifecycle、同一 action 时间边界、同一 (t,seq) 事件全序。**

---

## 7. Deterministic edge cases（v2 新增，纸面预答）

### 7.1 Edge case A：Action 中途存档/恢复（save/reload midway）

场景：hero1 的 attack1 进行到 t=6000（windup 中，impact 预定 5800 已过？——改用"进行到 windup 中 t=5200"更贴切：startAt 5000 / reachAt 5600 / impactAt 5800 / finishAt 6300，在 t=5200 存档）。

- 快照内容：`WorldState { t: 5200, entities（hero1/slime3 含 hp/position）, actions: [attack1（完整时间边界）], deadlines: [movement(5600), impact(5800), finish(6300), …], rng: {seed, cursor}, seq: 3 }`；
- 恢复后：`advance(state, 6300)` 必须与**从未中断**的连续运行在 t=6300 完全一致：impact 在 5800 触发、DamageApplied 的命中判定消费**同一个 RNG 游标**、事件 seq 从 4 继续、slime3 死亡序列不变；
- 证明要点：Action 的时间边界是数据、deadline 是数据、RNG 游标在快照内——恢复只是"继续推进"，无重算、无再决策；
- 对拍测试形态：`run(A, 0→6300) ≡ run(save(A, 5200), 5200→6300)`（final world + RNG state + events 语义一致）。

### 7.2 Edge case B：同一 SimTime 两个 deadline

场景：t=5800 同时存在 hero1 的 `attack.impact`（ordinal=11，先注册）与 slime3 的 `attack.impact`（ordinal=12，后注册，同刻反击）。

- Scheduler 按 `(at, ordinal)` 稳定执行：先 hero 后 slime；
- **业务结果由 combat domain 规则明确**（Scheduler 不猜），两种合法规则：
  - 规则 X：先结算 hero 伤害 → slime hp ≤ 0 → 死亡 → `EntityKilled` → slime 的**同刻未执行**反击被取消（`ActionCancelled`，无 DamageApplied）；
  - 规则 Y：同刻双方同时结算（同归于尽语义，双方都产出 DamageApplied 再死亡）；
- 合同要求：规则一经选择，同一输入永远同结果；对拍测试必须固定（如先注册先结算 + 死亡取消同刻未执行攻击，作为 R0/R1 默认规则）；
- 事件流确定性：`(t, seq)` 全序保证任何消费端（renderer/replay/测试）看到同一顺序。

---

## 8. 不变式总清单（写代码前的红线，v2）

1. `SimTime` 只增不减；规则禁止 `Date.now()`；
2. Entity 只能经 `EntitySpawned` / `EntityDespawned` 增删（world lifecycle）；`EntityKilled` 仅表 combat 击杀语义；id 跨存档稳定；
3. Action 时间边界由规则计算，**全部为数值**（缺失阶段用零长度区间表达，禁 nullable）；Action 不携带视觉参数；`activeUntil` 是 gameplay 语义；
4. `ActionPhase` 是 `phaseOf(action, t)` 纯派生值：terminal-first（cancelled → complete → …），表达"该 timestamp 所有 deadline 处理后的稳定 phase"；无第二真源、不依赖外部注册表；
5. 事件流按 `(t, seq)` 全序、不可变；renderer 不产生事件；
6. `advance` / `fastForward` 是纯函数：同 `(state, until)` → 同输出；
7. Scheduler 无 gameplay 分支；deadline 是纯数据 `(at, ordinal, kind, owner, payload)`，禁 closure；
8. RNG state/cursor 属于 snapshot；分段 advance 与整段 advance 对拍等价（RngState 连续性）；
9. 任何 renderer 实现不影响 simulation 输出；
10. Presentation 只消费 immutable `WorldState` snapshot + immutable `WorldEvent` stream；禁止 mutation / 私有调用；
11. 产出节奏（tick/DoT）是规则注册的 deadline，不硬编码进 Action 结构；
12. 同 t 冲突：Scheduler 只提供 `(at, ordinal)` 稳定执行顺序，业务结果由域规则明确并固定；
13. 空间/本地资源唯一权威在 entity/domain state；禁止同一资源存在两个权威计数器（无 global resource ledger 双重真相）；
14. Fast-forward 不省略 gameplay state transition；对拍目标为最终语义等价（非事件数量相同）；
15. `Entity.position` 是最近一次 committed anchor；`positionAt(world, entity, t)` 是 gameplay 获取位置的唯一公开查询；renderer 不得维护第二份 gameplay position。

---

## 9. Fast-forward 语义（v2 明确）

- fast-forward **可以省略/聚合 observational event materialization**（不逐 tick 产出 `ResourceGained` 的 presentation 事件），**但不能省略 gameplay state transition**：
  - 禁止："因为没生成某 tick 事件 → achievement/death/storage-full 等 gameplay consequence 消失"；
  - 批量推进时：资源不足/输入耗尽/storage 满/单位死亡/升级/解锁等判定必须与 real-time 完全一致；
- Real-time 与 fast-forward 对拍目标：**最终语义等价**（final world + RNG state + 关键语义事件序列），而不是要求拥有相同数量的 presentation events；
- 示例：机器 cycle=4s、离线 8h → fast-forward 直接 `cycles = floor(28800/4)` 聚合，但每个 cycle 内的"原料是否足够、产出是否被 storage 容量截断、期间 worker 是否死亡"逐 cycle 判定；
- 实现形态：`fastForward(world, until)` 与 `advance` 共享同一规则注册表，只是调度粒度与事件物化策略不同。

---

## 10. 资源真相（v2：消除双重计数）

- **空间/本地资源唯一权威在 entity/domain state**：
  - `node_a.ore`（资源点存量）、`storage_b.ore`（仓库存量）、`miner1.inventory`（携带量）、loot 实体（地面物品）——各自是唯一权威；
  - 转移 = `ResourceConsumed(源) + ResourceGained(目标)` 两个事件，由规则原子产生（同一 deadline 内、相邻 seq）；
- **删除 `WorldState.resources` 全局账本**（R0/R1 不需要；若未来需要 meta ledger（如跨存档总量/赛季统计），必须独立语义、独立于实体计数，并明确它不是结算权威）；
- 不变量：同一份 ore 不允许同时存在两个 authoritative counters（§8 不变式 13）。

---

## 11. 创建新 repository 的准入门（Exit criteria，v2）

只有以下全部成立，才允许创建 `incremental-world-runtime` 仓库：

1. [ ] 本合同冻结：9 核心原语 + 2 配套原语（RngState / ScheduledDeadline）+ 15 条不变式（可小幅命名调整，语义不变）；
2. [ ] 两个 scenario 的纸面走查无 hack（§6 表格全 ✓），两个 deterministic edge cases（§7）合同成立；
3. [ ] 首个实现计划 = **纯 TS headless**：Scheduler（(at,ordinal) 全序 + 纯数据 deadline registry）+ 两个规则域的最小 smoke（gather 一轮 + attack 一轮，断言事件流 (t,seq) 与 phase 序列）+ edge case 对拍（中途存档 / 同刻双 deadline / RNG 分段等价）——即 R0/R1 合一；
4. [ ] 在此之前不选择渲染引擎、不写 Vue/Canvas/Pixi 代码；
5. [ ] 旧产品线保持 FROZEN（production freeze SHA `5c29e83807be3e17ed99bbda6fa97fe0ab1ceaed`），零生产触碰。

---

*本文件为纸面设计，未写任何代码、未创建任何仓库、未修改旧产品线。
版本链：Repair 1 baseline `240ee111` → Repair 2（本版）→ 待 CONTRACT FREEZE 批准。*
