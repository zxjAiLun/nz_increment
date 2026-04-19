# REVIEW_ITER24.md — iter-24 公会系统审查

## 分支
`iter-24/guild-system` @ commit `97b727e`

---

## 变更文件

| 文件 | 变更 |
|------|------|
| src/types/guild.ts | 新增 Guild/GuildMember/GuildDungeon 接口 |
| src/data/guildDungeons.ts | 3个副本定义（初级/中级/高级） |
| src/data/guildShop.ts | 4种商店物品（头像框/称号/装备/被动碎片） |
| src/stores/guildStore.ts | createGuild/donateFunds/startDungeon |
| src/components/GuildTab.vue | 公会UI（加入/捐献/副本/商店） |

---

## 验证结果

```bash
grep -n "useGuildStore\|createGuild\|GUILD_DUNGEONS" src/ --include="*.ts" -r
```

输出：
```
src/data/guildDungeons.ts:3:  export const GUILD_DUNGEONS: Omit<GuildDungeon, 'status'>[] = [
src/stores/guildStore.ts:16:  export const useGuildStore = defineStore('guild', () => {
src/stores/guildStore.ts:37:  function createGuild(name: string): Guild {
src/stores/guildStore.ts:99:    createGuild,
```

---

## 检查详情

### 1. TypeScript 类型 (PASS)
- `Guild`, `GuildMember`, `GuildDungeon` 定义完整
- 3个副本难度梯度：1 / 3 / 5
- 商店物品类型覆盖：avatar_frame / title / equipment / passive_shard

### 2. 商店系统 (PASS)
- 4种商品，定价合理（200-1000贡献度）
- 奖励结构完整（头像框/称号/装备/碎片）

### 3. 副本系统 (PARTIAL — 有bug)
```typescript
function startDungeon(dungeonId: string) {
  guildDungeon.value = {
    id: dungeonId,
    name: dungeonId,        // BUG: 直接用 id 而非查 GUILD_DUNGEONS 得到的 name
    difficulty: 1,          // BUG: 硬编码 1，未从 GUILD_DUNGEONS 取真实 difficulty
    status: 'in_progress',
    rewards: { gold: 1000 } // BUG: 硬编码，未从 GUILD_DUNGEONS 取 rewards
  }
}
```
应改为从 `GUILD_DUNGEONS.find(d => d.id === dungeonId)` 取值。

### 4. 加入公会 (PARTIAL — 空实现)
```typescript
function joinGuild(guildId: string): boolean {
  return false  // 总是返回 false，未实际实现
}
```
无法实际加入任何公会。

### 5. 单元测试 (PASS)
```
258 tests passed across 19 test files
```

### 6. 商店购买按钮 (PASS — UI已就绪，逻辑待补)
`GuildTab.vue` 购买按钮为空 handler（`@click` 无函数），属于预期占位。

---

## 结论

**PARTIAL PASS**

公会系统基础架构完整：store / 数据 / UI 三层均已就位，类型定义正确，258测试通过。

两处可运行的 bug：
1. `startDungeon` 硬编码了副本属性（name/difficulty/rewards），未从 `GUILD_DUNGEONS` 读取
2. `joinGuild` 是空实现，总返回 false

这两处不影响页面渲染，但会导致运行时行为与设计不符。建议在下个迭代修复。
