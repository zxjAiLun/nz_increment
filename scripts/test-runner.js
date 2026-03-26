/**
 * 游戏测试运行器
 *
 * 使用方法：
 * 1. 在浏览器中打开游戏
 * 2. 按F12打开控制台
 * 3. 粘贴此脚本内容并执行
 *
 * 或者：
 * 在HTML中引入此脚本
 */

// ============================================
// 测试配置
// ============================================

const TEST_CONFIG = {
  maxStuckMinutes: 20,      // 卡关超时（分钟）
  maxDeathCount: 10,        // 连续死亡上限
  maxRunMinutes: 30,        // 最大运行时长（分钟）
  autoRebirthEnabled: true, // 自动转生
  tickInterval: 1000,        // 模拟tick间隔（毫秒）
}

// ============================================
// 玩家操作池
// ============================================

const PLAYER_ACTIONS = {
  // 升级属性
  upgradeAttack: () => {
    const cost = window.gameVM.playerStore.getUpgradeCost('attack')
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.upgradeStat('attack', cost)
      return true
    }
    return false
  },
  upgradeDefense: () => {
    const cost = window.gameVM.playerStore.getUpgradeCost('defense')
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.upgradeStat('defense', cost)
      return true
    }
    return false
  },
  upgradeMaxHp: () => {
    const cost = window.gameVM.playerStore.getUpgradeCost('maxHp')
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.upgradeStat('maxHp', cost)
      return true
    }
    return false
  },
  upgradeSpeed: () => {
    const cost = window.gameVM.playerStore.getUpgradeCost('speed')
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.upgradeStat('speed', cost)
      return true
    }
    return false
  },

  // 抽奖
  lottery: () => {
    const cost = window.gameVM.playerStore.getLotteryCost()
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.doLottery()
      return true
    }
    return false
  },
  lottery10: () => {
    const cost = window.gameVM.playerStore.getLottery10Cost()
    if (window.gameVM.playerStore.player.gold >= cost) {
      window.gameVM.playerStore.doLottery10()
      return true
    }
    return false
  },

  // 转生
  rebirth: () => {
    if (window.gameVM.monsterStore.difficultyValue >= 10) {
      window.gameVM.rebirthStore.performRebirth()
      return true
    }
    return false
  },

  // 切换模式
  switchToTraining: () => {
    window.gameVM.gameStore.switchBattleMode('training')
  },
  switchToMain: () => {
    window.gameVM.gameStore.switchBattleMode('battle')
  },

  // 装备技能
  equipSkill: (skillId, slotIndex) => {
    const skill = window.gameVM.skillStore.getSkillById(skillId)
    if (skill) {
      window.gameVM.playerStore.learnSkill(skill, slotIndex)
      return true
    }
    return false
  }
}

// ============================================
// 策略管理器
// ============================================

class StrategyManager {
  constructor() {
    this.deathCount = 0
    this.lastDifficulty = 0
    this.stuckTime = 0
    this.isInTrainingMode = false
  }

  // 决策：当前应该执行什么行动
  decide() {
    const player = window.gameVM.playerStore.player
    const gold = player.gold
    const difficulty = window.gameVM.monsterStore.difficultyValue
    const deathCount = this.deathCount

    // 检查是否卡关
    if (difficulty === this.lastDifficulty) {
      if (this.stuckTime === 0) {
        this.stuckTime = Date.now()
      }
    } else {
      this.stuckTime = 0
      this.lastDifficulty = difficulty
    }

    // 策略1：如果死亡次数过多，切换到练功房
    if (deathCount >= 3 && !this.isInTrainingMode) {
      PLAYER_ACTIONS.switchToTraining()
      this.isInTrainingMode = true
      return { action: 'switchToTraining', reason: '死亡过多' }
    }

    // 策略2：如果金币足够抽卡，先抽卡
    const lottery10Cost = window.gameVM.playerStore.getLottery10Cost()
    if (gold >= lottery10Cost) {
      PLAYER_ACTIONS.lottery10()
      return { action: 'lottery10', reason: '金币充足' }
    }

    const lotteryCost = window.gameVM.playerStore.getLotteryCost()
    if (gold >= lotteryCost) {
      PLAYER_ACTIONS.lottery()
      return { action: 'lottery', reason: '金币足够单抽' }
    }

    // 策略3：升级属性
    const attackCost = window.gameVM.playerStore.getUpgradeCost('attack')
    if (gold >= attackCost) {
      PLAYER_ACTIONS.upgradeAttack()
      return { action: 'upgradeAttack', reason: '升级攻击' }
    }

    // 策略4：如果在练功房且金币充足，回去打主线
    if (this.isInTrainingMode && gold > lottery10Cost * 0.5) {
      PLAYER_ACTIONS.switchToMain()
      this.isInTrainingMode = false
      return { action: 'switchToMain', reason: '金币充足，回去推图' }
    }

    // 策略5：继续在练功房刷金币
    if (this.isInTrainingMode) {
      // 升级一些防御增加生存能力
      const defenseCost = window.gameVM.playerStore.getUpgradeCost('defense')
      if (gold >= defenseCost * 2) {
        PLAYER_ACTIONS.upgradeDefense()
        return { action: 'upgradeDefense', reason: '练功房升级防御' }
      }
    }

    return { action: 'none', reason: '无操作' }
  }
}

// ============================================
// 测试运行器
// ============================================

class GameTestRunner {
  constructor(config = {}) {
    this.config = { ...TEST_CONFIG, ...config }
    this.strategy = new StrategyManager()
    this.running = false
    this.startTime = 0
    this.tickIntervalId = null

    // 测试数据
    this.actions = []
    this.events = []
    this.metrics = {
      dpsSamples: [],
      goldHistory: [],
      difficultyHistory: [],
      deathCount: 0,
    }
  }

  // 记录事件
  log(type, message, details = {}) {
    const event = {
      timestamp: Date.now() - this.startTime,
      type,
      message,
      details
    }
    this.events.push(event)
    console.log(`[${type.toUpperCase()}] ${message}`, details)
  }

  // 记录行动
  recordAction(action, result) {
    this.actions.push({
      timestamp: Date.now() - this.startTime,
      action,
      result
    })
  }

  // 收集指标
  collectMetrics() {
    const player = window.gameVM.playerStore.player
    const gameStore = window.gameVM.gameStore
    const monsterStore = window.gameVM.monsterStore

    this.metrics.goldHistory.push(player.gold)
    this.metrics.difficultyHistory.push(monsterStore.difficultyValue)

    if (gameStore.damageStats.value.totalDamage > 0) {
      const elapsedSeconds = (Date.now() - this.startTime) / 1000
      const dps = gameStore.damageStats.value.totalDamage / elapsedSeconds
      this.metrics.dpsSamples.push(dps)
    }
  }

  // 检查终止条件
  checkTermination() {
    const now = Date.now()
    const elapsedMinutes = (now - this.startTime) / 60000

    // 1. 超时
    if (elapsedMinutes >= this.config.maxRunMinutes) {
      return { terminated: true, reason: `达到最大运行时长 (${this.config.maxRunMinutes}分钟)` }
    }

    // 2. 自动转生
    if (this.config.autoRebirthEnabled && window.gameVM.monsterStore.difficultyValue >= 100) {
      return { terminated: true, reason: '达到自动转生条件 (难度>=100)' }
    }

    // 3. 死亡次数过多
    if (this.strategy.deathCount >= this.config.maxDeathCount) {
      return { terminated: true, reason: `连续死亡${this.strategy.deathCount}次` }
    }

    // 4. 卡关超时
    if (this.strategy.stuckTime > 0) {
      const stuckMinutes = (now - this.strategy.stuckTime) / 60000
      if (stuckMinutes >= this.config.maxStuckMinutes) {
        return { terminated: true, reason: `卡关超过${this.config.maxStuckMinutes}分钟` }
      }
    }

    return { terminated: false, reason: null }
  }

  // 处理战斗
  processBattle() {
    const gameStore = window.gameVM.gameStore
    const monsterStore = window.gameVM.monsterStore
    const playerStore = window.gameVM.playerStore
    const trainingStore = window.gameVM.trainingStore

    if (gameStore.isPaused) return

    if (gameStore.battleMode === 'battle') {
      // 主线战斗
      if (monsterStore.currentMonster) {
        const damage = playerStore.totalStats.attack
        const result = monsterStore.damageMonster(damage)

        if (result.killed) {
          playerStore.addGold(result.goldReward)
          playerStore.addExperience(result.expReward)

          if (playerStore.isDead()) {
            playerStore.revive()
            this.strategy.deathCount++
            this.metrics.deathCount++
            this.log('death', `死亡 x${this.metrics.deathCount}`, {
              difficulty: monsterStore.difficultyValue
            })
          }
        }
      }
    } else if (gameStore.battleMode === 'training') {
      // 练功房战斗
      if (!trainingStore.currentTrainingMonster) {
        trainingStore.spawnTrainingMonster()
      }

      const damage = playerStore.totalStats.attack
      const result = trainingStore.damageTrainingMonster(damage)

      if (result.killed) {
        playerStore.addGold(result.goldReward)
        playerStore.addExperience(result.expReward)

        if (result.statDrop) {
          playerStore.addStatReward(result.statDrop.type, result.statDrop.value)
        }

        // 检测是否秒杀（秒杀则提高练功房难度）
        if (result.goldReward < playerStore.totalStats.attack * 0.1) {
          // 如果金币奖励小于攻击力的10%，认为是秒杀
          trainingStore.autoUpgrade()
        }
      }
    }
  }

  // 主循环
  tick() {
    // 处理战斗
    this.processBattle()

    // 做出策略决策
    const decision = this.strategy.decide()
    if (decision.action !== 'none') {
      this.recordAction(decision.action, decision.reason)
    }

    // 检查是否升级
    const oldLevel = window.gameVM.playerStore.player.level
    window.gameVM.playerStore.addExperience(0)
    if (window.gameVM.playerStore.player.level > oldLevel) {
      this.log('levelup', `升级到 Lv.${window.gameVM.playerStore.player.level}`, {
        attack: window.gameVM.playerStore.player.stats.attack,
        defense: window.gameVM.playerStore.player.stats.defense
      })
    }

    // 收集指标
    if (this.actions.length % 10 === 0) {
      this.collectMetrics()
    }

    // 保存游戏
    window.gameVM.playerStore.saveGame()

    // 检查终止条件
    const termination = this.checkTermination()
    if (termination.terminated) {
      this.stop()
      this.showReport(termination.reason)
      return
    }

    // 显示进度
    if (this.actions.length % 30 === 0) {
      const elapsed = ((Date.now() - this.startTime) / 60000).toFixed(1)
      const diff = window.gameVM.monsterStore.difficultyValue
      const gold = window.gameVM.playerStore.player.gold.toLocaleString()
      const level = window.gameVM.playerStore.player.level
      console.log(`[PROGRESS] ${elapsed}min | 难度:${diff} | 金币:${gold} | Lv.${level} | 死亡:${this.strategy.deathCount}`)
    }
  }

  // 启动测试
  start() {
    if (this.running) {
      console.warn('测试已在运行中')
      return
    }

    this.running = true
    this.startTime = Date.now()
    this.strategy = new StrategyManager()

    console.log('='.repeat(50))
    console.log('游戏测试启动')
    console.log(`配置:`, this.config)
    console.log('='.repeat(50))

    this.log('start', '测试开始', this.config)

    this.tickIntervalId = setInterval(() => this.tick(), this.config.tickInterval)
  }

  // 停止测试
  stop() {
    if (!this.running) return

    this.running = false
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId)
      this.tickIntervalId = null
    }

    this.log('stop', '测试结束')
  }

  // 生成报告
  showReport(terminationReason) {
    const endTime = Date.now()
    const duration = endTime - this.startTime
    const player = window.gameVM.playerStore.player
    const monsterStore = window.gameVM.monsterStore
    const gameStore = window.gameVM.gameStore

    const avgDPS = this.metrics.dpsSamples.length > 0
      ? this.metrics.dpsSamples.reduce((a, b) => a + b, 0) / this.metrics.dpsSamples.length
      : 0

    const avgGoldPerSecond = this.metrics.goldHistory.length > 0
      ? (player.gold - this.metrics.goldHistory[0]) / (duration / 1000)
      : 0

    console.log('\n' + '='.repeat(60))
    console.log('测试结果分析报告')
    console.log('='.repeat(60))
    console.log('')
    console.log('【基本信息】')
    console.log(`  运行时长: ${(duration / 60000).toFixed(1)} 分钟`)
    console.log(`  终止原因: ${terminationReason}`)
    console.log(`  转生次数: ${window.gameVM.rebirthStore.totalRebirthCount}`)
    console.log('')
    console.log('【最终状态】')
    console.log(`  难度值: ${monsterStore.difficultyValue}`)
    console.log(`  怪物等级: ${monsterStore.monsterLevel}`)
    console.log(`  玩家等级: ${player.level}`)
    console.log(`  金币: ${player.gold.toLocaleString()}`)
    console.log(`  钻石: ${player.diamond.toLocaleString()}`)
    console.log('')
    console.log('【战斗统计】')
    console.log(`  总伤害: ${gameStore.damageStats.value.totalDamage.toLocaleString()}`)
    console.log(`  击杀数: ${gameStore.damageStats.value.killCount.toLocaleString()}`)
    console.log(`  行动次数: ${this.actions.length}`)
    console.log('')
    console.log('【性能指标】')
    console.log(`  平均DPS: ${Math.floor(avgDPS).toLocaleString()}`)
    console.log(`  金币收益: ${Math.floor(avgGoldPerSecond * 3600).toLocaleString()}/h`)
    console.log('')
    console.log('【伤害构成】')
    const stats = gameStore.damageStats.value
    const total = stats.normalDamage + stats.critDamage + stats.skillDamage + stats.voidDamage + stats.trueDamage
    if (total > 0) {
      console.log(`  普通伤害: ${stats.normalDamage.toLocaleString()} (${(stats.normalDamage/total*100).toFixed(1)}%)`)
      console.log(`  暴击伤害: ${stats.critDamage.toLocaleString()} (${(stats.critDamage/total*100).toFixed(1)}%)`)
      console.log(`  技能伤害: ${stats.skillDamage.toLocaleString()} (${(stats.skillDamage/total*100).toFixed(1)}%)`)
      console.log(`  虚空伤害: ${stats.voidDamage.toLocaleString()} (${(stats.voidDamage/total*100).toFixed(1)}%)`)
      console.log(`  真实伤害: ${stats.trueDamage.toLocaleString()} (${(stats.trueDamage/total*100).toFixed(1)}%)`)
    }
    console.log('')
    console.log('【事件记录】')
    const eventCounts = {}
    for (const e of this.events) {
      eventCounts[e.type] = (eventCounts[e.type] || 0) + 1
    }
    for (const [type, count] of Object.entries(eventCounts)) {
      console.log(`  ${type}: ${count}次`)
    }
    console.log('')
    console.log('【行动记录】')
    const actionCounts = {}
    for (const a of this.actions) {
      actionCounts[a.action] = (actionCounts[a.action] || 0) + 1
    }
    for (const [action, count] of Object.entries(actionCounts)) {
      console.log(`  ${action}: ${count}次`)
    }
    console.log('')
    console.log('【最近事件】')
    const recentEvents = this.events.slice(-10)
    for (const e of recentEvents) {
      const time = (e.timestamp / 1000).toFixed(0) + 's'
      console.log(`  [${time}] ${e.message}`)
    }
    console.log('')
    console.log('='.repeat(60))
    console.log('')

    // 导出JSON
    const result = {
      config: this.config,
      terminationReason,
      duration,
      finalStats: {
        difficultyValue: monsterStore.difficultyValue,
        monsterLevel: monsterStore.monsterLevel,
        playerLevel: player.level,
        gold: player.gold,
        diamond: player.diamond,
        totalDamage: gameStore.damageStats.value.totalDamage,
        killCount: gameStore.damageStats.value.killCount,
        rebirthCount: window.gameVM.rebirthStore.totalRebirthCount
      },
      metrics: {
        avgDPS,
        avgGoldPerSecond,
        dpsSamples: this.metrics.dpsSamples,
        goldHistory: this.metrics.goldHistory,
        difficultyHistory: this.metrics.difficultyHistory
      },
      actions: this.actions,
      events: this.events
    }

    // 复制到剪贴板
    const jsonStr = JSON.stringify(result, null, 2)
    console.log('完整JSON日志已复制到剪贴板')
    navigator.clipboard.writeText(jsonStr).catch(() => {})

    return result
  }

  // 导出日志
  exportLog() {
    const result = {
      config: this.config,
      duration: Date.now() - this.startTime,
      finalStats: {
        difficultyValue: window.gameVM.monsterStore.difficultyValue,
        monsterLevel: window.gameVM.monsterStore.monsterLevel,
        playerLevel: window.gameVM.playerStore.player.level,
        gold: window.gameVM.playerStore.player.gold,
        diamond: window.gameVM.playerStore.player.diamond,
        totalDamage: window.gameVM.gameStore.damageStats.value.totalDamage,
        killCount: window.gameVM.gameStore.damageStats.value.killCount,
        rebirthCount: window.gameVM.rebirthStore.totalRebirthCount
      },
      actions: this.actions,
      events: this.events,
      metrics: this.metrics
    }

    return JSON.stringify(result, null, 2)
  }
}

// 创建全局实例
window.gameTestRunner = new GameTestRunner()

// 导出
console.log(`
========================================
游戏测试运行器已加载
========================================

使用方法:
  window.gameTestRunner.start()  - 开始测试
  window.gameTestRunner.stop()   - 停止测试
  window.gameTestRunner.exportLog() - 导出日志
  window.gameTestRunner.showReport() - 显示报告

配置选项:
  window.gameTestRunner.config.maxStuckMinutes = 20   // 卡关超时(分钟)
  window.gameTestRunner.config.maxDeathCount = 10     // 连续死亡上限
  window.gameTestRunner.config.maxRunMinutes = 30    // 最大运行时长
  window.gameTestRunner.config.autoRebirthEnabled = true // 自动转生

示例 - 自定义配置:
  window.gameTestRunner.config.maxRunMinutes = 60
  window.gameTestRunner.config.autoRebirthEnabled = false
  window.gameTestRunner.start()
========================================
`)
