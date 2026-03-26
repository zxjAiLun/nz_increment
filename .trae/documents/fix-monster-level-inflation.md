# 怪物等级膨胀与游戏平衡修复计划

## 问题分析

### 问题1: 虚空领主 Lv.1422750817 等级膨胀太快
- **原因**: `getNextMonsterLevel` 使用 `Math.floor(currentMonster.level * 1.05) + 1` 导致指数增长
- **影响**: 等级爆炸，关联属性（金币成本等）全部失控

### 问题2: 怪物基础属性增长太慢，速度属性基本没有增长
- **原因**: 速度增长系数仅为 `difficultyValue * 0.005`，而攻击/防御使用 `baseValue * 10/5`
- **影响**: 玩家攻击远高于怪物，玩家战斗体验单调

### 问题3: 十连需要的金币抽奖数是1e87
- **原因**: `getLotteryCost` = `100 * Math.pow(1.1, level)`，等级1.4B时成本天文数字
- **影响**: 抽奖系统完全失效

### 问题4: 百分比属性（穿透、暴击爆伤）数值过大
- **原因**: 装备生成时 `levelScale = Math.pow(1.15, difficultyValue / 50)` 影响所有属性
- **影响**: 暴击率、穿透等数值失控

### 问题5: 重置游戏后难度值没有重置
- **原因**: `playerStore.resetGame()` 只重置玩家数据，未重置 `monsterStore.difficultyValue`
- **影响**: 重置后仍然打高难度怪物

### 问题6: 练功房怪物防御值没有生效
- **原因**: `damageTrainingMonster` 直接 `currentHp -= damage`，未计算防御减免
- **影响**: 练功房战斗系统与主线不一致

---

## 修复方案

### 修复1: 怪物等级增长公式
**文件**: `src/utils/monsterGenerator.ts`

```typescript
// 原公式 (问题)
return Math.floor(currentMonster.level * 1.05) + 1

// 新公式 - 使用难度值作为等级，避免膨胀
export function getNextMonsterLevel(currentMonster: Monster, difficultyValue: number): number {
  if (currentMonster.isBoss) {
    return Math.floor(difficultyValue / 10) + 1
  }
  return Math.floor(difficultyValue / 10) + 1
}
```

### 修复2: 怪物属性增长曲线
**文件**: `src/utils/monsterGenerator.ts`

```typescript
// 原速度 (问题)
const speed = 10 + difficultyValue * 0.005

// 新速度 - 调整增长曲线
const speed = 10 + Math.pow(difficultyValue, 0.5) * 2

// 原防御增长 (问题)
// defense = baseValue * 5

// 新防御增长 - 略微提升
const defense = baseValue * 6
```

### 修复3: 抽奖成本重设
**文件**: `src/stores/playerStore.ts`

```typescript
// 原成本 (问题)
function getLotteryCost(): number {
  const level = player.value.level
  return Math.floor(100 * Math.pow(1.1, level))
}

// 新成本 - 使用对数增长，有上限
function getLotteryCost(): number {
  const difficulty = Math.max(1, monsterStore.difficultyValue)
  return Math.floor(100 * Math.pow(1.05, difficulty))
}

function getLottery10Cost(): number {
  return Math.floor(getLotteryCost() * 8) // 八折优惠
}
```

### 修复4: 百分比属性上限
**文件**: `src/utils/equipmentGenerator.ts`

```typescript
// 添加属性上限
const STAT_MAX_VALUES: Record<StatType, number> = {
  attack: Infinity,
  defense: Infinity,
  maxHp: Infinity,
  speed: 10000,
  critRate: 95,      // 暴击率上限95%
  critDamage: 500,   // 暴击伤害上限500%
  penetration: 100,
  dodge: 80,
  accuracy: 100,
  critResist: 80,
  combo: 1000,
  damageBonusI: 500,
  damageBonusII: 500,
  damageBonusIII: 500,
  luck: 1000,
  // ... 其他
}

const stats: StatBonus[] = statTypes.map(type => {
  const [min, max] = STAT_VALUES[type]
  const value = randomInt(min, max) * levelScale * rarityScale
  const isPercent = ['critRate', 'dodge', 'timeWarp', 'critDamage', 'accuracy', 'critResist'].includes(type)
  const finalValue = isPercent ? Math.min(value, STAT_MAX_VALUES[type]) : Math.floor(value)
  return { type, value: finalValue, isPercent }
})
```

### 修复5: 重置游戏时重置难度值
**文件**: `src/stores/playerStore.ts`

```typescript
import { useMonsterStore } from './monsterStore'

function resetGame() {
  const monsterStore = useMonsterStore()
  player.value = createDefaultPlayer()
  monsterStore.initMonster() // 重置难度值
  pendingOfflineReward.value = null
  activeBuffs.value.clear()
  saveGame()
}
```

### 修复6: 练功房战斗系统
**文件**: `src/stores/trainingStore.ts`

```typescript
function damageTrainingMonster(playerAttack: number, playerDefense: number): DamageResult {
  if (!currentTrainingMonster.value) {
    return { killed: false, goldReward: 0, expReward: 0, diamondReward: 0, shouldDropEquipment: false, actualDamage: 0 }
  }
  
  const monster = currentTrainingMonster.value
  
  // 计算有效伤害（考虑防御）
  const effectiveDefense = Math.max(0, monster.defense - playerAttack * 0.1)
  const damageReduction = effectiveDefense / (effectiveDefense + 200)
  const actualDamage = Math.max(1, Math.floor(playerAttack * (1 - damageReduction)))
  
  monster.currentHp -= actualDamage
  
  if (monster.currentHp <= 0) {
    // 击杀逻辑...
  }
  
  return { /* ... */, actualDamage }
}
```

---

## 实施步骤

1. **修改 monsterGenerator.ts**
   - 修复 `getNextMonsterLevel` 函数
   - 调整怪物属性增长曲线

2. **修改 playerStore.ts**
   - 重设 `getLotteryCost` 和 `getLottery10Cost`
   - 修改 `resetGame` 函数
   - 调整抽奖奖励的百分比属性上限

3. **修改 equipmentGenerator.ts**
   - 添加属性上限常量
   - 修改装备属性生成逻辑

4. **修改 trainingStore.ts**
   - 重写 `damageTrainingMonster` 函数
   - 添加防御计算

5. **测试验证**
   - 验证等级不再膨胀
   - 验证抽奖成本合理
   - 验证重置游戏功能正常
   - 验证练功房战斗逻辑正确
