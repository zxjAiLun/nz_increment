# 游戏测试脚本系统

## 概述

本系统用于自动模拟玩家行为，测试游戏平衡性，生成详细的测试日志和报告。

## 文件说明

- `test-runner.js` - 浏览器端测试运行器（主要使用）
- `game-simulator.ts` - Node.js 模拟器（需要Vue运行时）

## 使用方法

### 方法1：浏览器控制台运行（推荐）

1. 在浏览器中启动游戏 (`npm run dev`)
2. 按 F12 打开开发者工具
3. 切换到 Console（控制台）标签
4. 复制 `test-runner.js` 的全部内容，粘贴到控制台并按 Enter
5. 运行测试：

```javascript
// 使用默认配置开始测试
window.gameTestRunner.start()

// 自定义配置
window.gameTestRunner.config.maxRunMinutes = 60     // 运行60分钟
window.gameTestRunner.config.maxDeathCount = 5      // 死亡5次后停止
window.gameTestRunner.config.autoRebirthEnabled = true // 启用自动转生
window.gameTestRunner.start()
```

### 方法2：开发环境自动注入

启动开发服务器后，访问带查询参数的地址：

```text
http://localhost:5173/?quickTest=1
```

页面会在开发环境自动加载 `quick-test.js`。生产构建不会再注入测试脚本。

## 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxStuckMinutes` | number | 20 | 卡关超时时间（分钟） |
| `maxDeathCount` | number | 10 | 连续死亡次数上限 |
| `maxRunMinutes` | number | 30 | 最大运行时长（分钟） |
| `autoRebirthEnabled` | boolean | true | 是否自动转生 |
| `tickInterval` | number | 1000 | 模拟tick间隔（毫秒） |

## API

### 启动/停止

```javascript
window.gameTestRunner.start()  // 开始测试
window.gameTestRunner.stop()   // 停止测试
```

### 查看结果

```javascript
window.gameTestRunner.showReport()  // 在控制台显示报告
window.gameTestRunner.exportLog()   // 导出JSON格式日志
```

### 修改配置

```javascript
// 设置运行30分钟
window.gameTestRunner.config.maxRunMinutes = 30

// 设置死亡10次后停止
window.gameTestRunner.config.maxDeathCount = 10

// 禁用自动转生
window.gameTestRunner.config.autoRebirthEnabled = false
```

## 测试终止条件

测试会在以下任一条件满足时自动停止：

1. **超时停止**：运行时间达到 `maxRunMinutes`
2. **自动转生**：启用自动转生且难度值达到100
3. **死亡过多**：连续死亡达到 `maxDeathCount` 次
4. **卡关超时**：在同一难度停留超过 `maxStuckMinutes` 分钟无进展

## 输出报告示例

```
============================================================
测试结果分析报告
============================================================

【基本信息】
  运行时长: 15.2 分钟
  终止原因: 连续死亡10次
  转生次数: 0

【最终状态】
  难度值: 23
  怪物等级: 45
  玩家等级: 12
  金币: 125,000
  钻石: 50

【战斗统计】
  总伤害: 1,234,567
  击杀数: 890
  行动次数: 45

【性能指标】
  平均DPS: 1,350
  金币收益: 8,500/h

【事件记录】
  death: 10次
  levelup: 5次
  action: 45次

【最近事件】
  [890s] 死亡 x8
  [895s] 升级到 Lv.12
  [900s] 死亡 x9
  [905s] 死亡 x10
```

## 玩家策略说明

测试运行器模拟以下玩家策略：

### 行动优先级

1. **高优先级**：金币抽奖（当金币足够10连时）
2. **高优先级**：单抽（当金币足够单抽时）
3. **中优先级**：升级攻击属性
4. **低优先级**：升级防御属性
5. **切换模式**：死亡3次后切换到练功房
6. **切换模式**：金币充足时返回主线推图

### 策略决策逻辑

```
如果 (死亡次数 >= 3) 且 (不在练功房)
    切换到练功房
否则如果 (金币 >= 10连抽成本)
    执行10连抽
否则如果 (金币 >= 单抽成本)
    执行单抽
否则如果 (金币 >= 攻击升级成本)
    升级攻击
否则如果 (在练功房 且 金币充足)
    升级防御
否则
    继续当前模式战斗
```

## 日志格式

导出的JSON日志包含以下结构：

```json
{
  "config": { /* 测试配置 */ },
  "terminationReason": "连续死亡10次",
  "duration": 912000,
  "finalStats": {
    "difficultyValue": 23,
    "monsterLevel": 45,
    "playerLevel": 12,
    "gold": 125000,
    "diamond": 50,
    "totalDamage": 1234567,
    "killCount": 890,
    "rebirthCount": 0
  },
  "metrics": {
    "avgDPS": 1350,
    "avgGoldPerSecond": 2.36,
    "dpsSamples": [...],
    "goldHistory": [...],
    "difficultyHistory": [...]
  },
  "actions": [
    { "timestamp": 0, "action": "lottery10", "result": "金币充足" },
    ...
  ],
  "events": [
    { "timestamp": 0, "type": "start", "message": "测试开始", "details": {} },
    ...
  ]
}
```

## 分析维度

测试报告提供以下分析维度：

1. **进度分析**：难度值、等级提升速度
2. **战斗效率**：DPS、击杀速度、死亡次数
3. **经济分析**：金币收入/支出、抽奖收益
4. **时间分配**：主线vs练功房时间占比
5. **瓶颈识别**：卡关原因、死亡原因

## 调试建议

根据测试结果调整游戏数值的方向：

| 问题 | 建议调整 |
|------|----------|
| DPS过低 | 提高基础攻击成长、降低怪物防御 |
| 死亡过多 | 提高玩家血量、降低怪物伤害 |
| 金币不足 | 提高金币掉落、增加抽奖保底 |
| 升级太慢 | 提高经验掉落、降低升级所需经验 |
| 卡关频繁 | 调整难度曲线、增加过渡机制 |

## 注意事项

1. 测试脚本会实际修改游戏存档，请使用测试账号或备份存档
2. 长时间测试可能导致浏览器内存占用增加
3. 建议单次测试时间不超过60分钟
4. 测试完成后可使用 `exportLog()` 导出完整数据进行分析
