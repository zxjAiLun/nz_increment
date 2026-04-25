# nz_increment 平衡报告入口

> **状态：历史静态报告已废弃。**
>
> 本文件不再维护手写数值表，也不再作为怪物、防御、抽卡、生命偷取等公式的事实来源。旧版报告中曾出现过 `baseValue × 3` 怪物防御、`lifesteal = luck × 0.008%`、抽卡成本随难度指数增长等描述；这些内容已经与当前源码不一致。

---

## 当前事实来源

请以源码生成的报告为准：

```bash
npm run balance-report
```

默认输出：

```text
reports/balance-report.md
```

报告由 `src/systems/combat/battleSimulator.ts` 直接读取当前战斗、怪物、装备、技能和掉落公式生成，覆盖：

| 字段 | 说明 |
|---|---|
| difficulty | 难度点 |
| build | 构筑类型：均衡、暴击、坦克、破甲、幸运 |
| scenario | 场景：普通怪、Boss、高防 Boss、高闪避 Boss |
| winRate | 模拟胜率 |
| avgTTK | 平均击杀时间 |
| avgTTL | 平均生存时间 |
| deathRate | 死亡率 |
| goldPerMinute | 每分钟金币 |
| equipmentPerMinute | 每分钟装备 |
| mainFailureReason | 主要失败原因 |
| recommendedStat | 推荐关注属性或系统 |

报告还包含 `Guardrail Summary` 与 `Findings`，用于说明当前曲线是否触发数值护栏。

---

## 数值护栏检查

需要让异常数值阻断流程时运行：

```bash
npm run balance-check
```

行为：

- 与 `balance-report` 使用同一套模拟矩阵。
- 当存在 `fail` 级护栏时以非零状态退出。
- 适合在调整装备、怪物、技能、掉落或收益公式后运行。

当前护栏覆盖：

1. 普通怪 TTK 过长。
2. Boss 胜率长期过低。
3. 高防 Boss 被暴击流轻松击杀。
4. 高闪避 Boss 不需要命中也能通过。
5. 幸运流同时拥有最高战斗收益。

---

## 相关设计文档

- `GAME_DESIGN.md`：当前主线体验、五大流派、生成式平衡报告与数值护栏说明。
- `README.md`：玩家/项目视角的系统概览与运行命令。
- `CHANGELOG.md`：阶段 1-5 的工程和设计变更记录。

---

## 为什么废弃静态平衡表

静态表容易与源码漂移，尤其是以下高频变化项：

- 怪物 HP / 攻击 / 防御成长。
- 防御减伤 K 值。
- 装备等级成长与稀有度倍率。
- 技能倍率、穿透、真伤、虚空伤害。
- 生命偷取来源与上限。
- 抽卡成本、保底、每日免费逻辑。
- 掉落、金币、装备收益。

后续如需分享平衡结果，请提交由 `npm run balance-report` 生成的 `reports/balance-report.md`，而不是手写新的静态数值表。
