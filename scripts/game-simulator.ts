/**
 * 游戏测试模拟器
 *
 * 功能：
 * 1. 模拟玩家操作（升级、加点、抽卡、装备技能等）
 * 2. 模拟玩家策略（主线推进打不过去练功房等）
 * 3. 执行测试并生成日志
 * 4. 分析测试结果
 */

import { createPlayerStore } from '../src/stores/playerStore'
import { createMonsterStore } from '../src/stores/monsterStore'
import { createGameStore } from '../src/stores/gameStore'
import { createTrainingStore } from '../src/stores/trainingStore'
import { createRebirthStore } from '../src/stores/rebirthStore'
import { createAchievementStore } from '../src/stores/achievementStore'
import { createSkillStore } from '../src/stores/skillStore'

// ============================================
// 类型定义
// ============================================

interface PlayerAction {
  type: 'upgrade_stat' | 'lottery' | 'lottery10' | 'equip_skill' | 'rebirth' | 'switch_to_training' | 'switch_to_main'
  timestamp: number
  details: Record<string, any>
}

interface TestConfig {
  maxStuckMinutes: number        // 卡关超时时间（分钟）
  maxDeathCount: number         // 连续死亡次数上限
  maxRunMinutes: number         // 最大运行时间（分钟）
  autoRebirthEnabled: boolean    // 是否自动转生
  logLevel: 'minimal' | 'normal' | 'verbose'
}

interface TestResult {
  finalStats: {
    difficultyValue: number
    monsterLevel: number
    playerLevel: number
    gold: number
    diamond: number
    totalDamage: number
    killCount: number
    rebirthCount: number
  }
  actions: PlayerAction[]
  events: TestEvent[]
  metrics: TestMetrics
  terminationReason: string
  duration: number // 毫秒
}

interface TestEvent {
  timestamp: number
  type: 'level_up' | 'phase_complete' | 'death' | 'rebirth' | 'action_taken' | 'mode_switch' | 'stuck_warning'
  message: string
  details: Record<string, any>
}

interface TestMetrics {
  dpsSamples: number[]
  goldPerSecond: number[]
  expPerSecond: number[]
  damageBreakdown: Record<string, number>
  timeSpentInMainMode: number
  timeSpentInTrainingMode: number
  averageSessionDamage: number
}

// ============================================
// 游戏模拟器类
// ============================================

class GameSimulator {
  private player: ReturnType<typeof createPlayerStore>
  private monster: ReturnType<typeof createMonsterStore>
  private game: ReturnType<typeof createGameStore>
  private training: ReturnType<typeof createTrainingStore>
  private rebirth: ReturnType<typeof createRebirthStore>
  private achievement: ReturnType<typeof createAchievementStore>
  private skill: ReturnType<typeof createSkillStore>

  private config: TestConfig
  private actions: PlayerAction[] = []
  private events: TestEvent[] = []
  private metrics: TestMetrics

  private startTime: number = 0
  private lastDamageTime: number = 0
  private deathCount: number = 0
  private stuckCheckTime: number = 0
  private lastDifficulty: number = 0
  private isInTrainingMode: boolean = false

  private tickInterval: number = 100
  private running: boolean = false

  constructor(config: Partial<TestConfig> = {}) {
    this.config = {
      maxStuckMinutes: 20,
      maxDeathCount: 10,
      maxRunMinutes: 60,
      autoRebirthEnabled: true,
      logLevel: 'normal',
      ...config
    }

    // 初始化stores
    this.player = createPlayerStore()
    this.monster = createMonsterStore()
    this.game = createGameStore()
    this.training = createTrainingStore()
    this.rebirth = createRebirthStore()
    this.achievement = createAchievementStore()
    this.skill = createSkillStore()

    this.metrics = {
      dpsSamples: [],
      goldPerSecond: [],
      expPerSecond: [],
      damageBreakdown: {
        normal: 0,
        crit: 0,
        skill: 0,
        void: 0,
        true: 0
      },
      timeSpentInMainMode: 0,
      timeSpentInTrainingMode: 0,
      averageSessionDamage: 0
    }

    this.initGame()
  }

  private initGame() {
    this.player.loadGame()

    // 如果没有存档，初始化新游戏
    if (!this.monster.currentMonster) {
      this.monster.initMonster()
    }
  }

  // ============================================
  // 玩家操作
  // ============================================

  private upgradeStat(stat: 'attack' | 'defense' | 'maxHp' | 'speed') {
    const cost = this.player.getUpgradeCost(stat)
    if (this.player.player.gold >= cost) {
      this.player.upgradeStat(stat, cost)
      this.logAction('upgrade_stat', { stat, cost })
      return true
    }
    return false
  }

  private doLottery() {
    const result = this.player.doLottery()
    if (result) {
      this.logAction('lottery', { result })
      return result
    }
    return null
  }

  private doLottery10() {
    const result = this.player.doLottery10()
    if (result) {
      this.logAction('lottery10', { rewardCount: result.length })
      return result
    }
    return null
  }

  private learnSkill(skillId: string, slotIndex: number) {
    const skill = this.skill.getSkillById(skillId)
    if (skill) {
      this.player.learnSkill(skill, slotIndex)
      this.logAction('equip_skill', { skillId, slotIndex })
      return true
    }
    return false
  }

  private performRebirth() {
    if (this.monster.difficultyValue >= 10) {
      const result = this.rebirth.performRebirth()
      this.logEvent('rebirth', `转生完成，获得 ${result.pointsEarned} 点`, {
        pointsEarned: result.pointsEarned,
        totalRebirthCount: this.rebirth.totalRebirthCount
      })
      return result
    }
    return null
  }

  // ============================================
  // 战斗逻辑
  // ============================================

  private processMainBattle() {
    if (!this.monster.currentMonster || this.game.isPaused) return

    const damage = this.player.totalStats.attack
    const result = this.monster.damageMonster(damage)

    if (result.killed) {
      this.player.addGold(result.goldReward)
      this.player.addExperience(result.expReward)

      // 追踪伤害构成
      this.metrics.damageBreakdown.normal += result.goldReward

      // 检查死亡
      if (this.player.isDead()) {
        this.player.revive()
        this.deathCount++
        this.logEvent('death', `死亡次数: ${this.deathCount}`, { difficultyValue: this.monster.difficultyValue })
      }
    }
  }

  private processTrainingBattle() {
    if (!this.training.currentTrainingMonster) {
      this.training.spawnTrainingMonster()
    }

    const damage = this.player.totalStats.attack
    const result = this.training.damageTrainingMonster(damage)

    if (result.killed) {
      this.player.addGold(result.goldReward)
      this.player.addExperience(result.expReward)

      // 处理属性掉落
      if (result.statDrop) {
        this.player.addStatReward(result.statDrop.type as any, result.statDrop.value)
      }
    }
  }

  // ============================================
  // 策略决策
  // ============================================

  private decideAction() {
    const player = this.player.player
    const gold = player.gold
    const difficulty = this.monster.difficultyValue

    // 策略优先级
    const actions: Array<{ priority: number, action: () => boolean }> = []

    // 1. 如果金币足够抽卡，抽卡（优先）
    const lotteryCost = this.player.getLotteryCost()
    if (gold >= lotteryCost * 10) {
      actions.push({ priority: 10, action: () => !!this.doLottery10() })
    } else if (gold >= lotteryCost) {
      actions.push({ priority: 10, action: () => !!this.doLottery() })
    }

    // 2. 升级属性（金币充足时）
    const attackCost = this.player.getUpgradeCost('attack')
    if (gold >= attackCost) {
      actions.push({ priority: 8, action: () => this.upgradeStat('attack') })
    }

    const defenseCost = this.player.getUpgradeCost('defense')
    if (gold >= defenseCost && gold > attackCost * 2) {
      actions.push({ priority: 6, action: () => this.upgradeStat('defense') })
    }

    // 3. 如果死亡次数过多，切换到练功房
    if (this.deathCount >= 3 && !this.isInTrainingMode) {
      this.isInTrainingMode = true
      this.logEvent('mode_switch', '切换到练功房（死亡过多）', { deathCount: this.deathCount })
      return
    }

    // 4. 如果练功房金币效率高，留在练功房
    if (this.isInTrainingMode) {
      const trainingGoldPerHour = this.training.getGoldPerHour()
      // 粗略估算主线金币收益
      const mainGoldPerKill = this.monster.currentMonster?.goldReward || 10
      const estimatedMainGoldPerHour = mainGoldPerKill * 10 // 假设每秒10击杀

      if (trainingGoldPerHour > estimatedMainGoldPerHour * 0.8 && this.deathCount < 2) {
        // 留在练功房
        return
      } else {
        this.isInTrainingMode = false
        this.logEvent('mode_switch', '切换回主线', { deathCount: this.deathCount })
        return
      }
    }

    // 5. 执行最高优先级的行动
    actions.sort((a, b) => b.priority - a.priority)
    for (const { action } of actions) {
      if (action()) return
    }
  }

  // ============================================
  // 终止条件检查
  // ============================================

  private checkTermination(): string | null {
    const now = Date.now()
    const elapsedMinutes = (now - this.startTime) / 60000

    // 1. 检查最大运行时间
    if (elapsedMinutes >= this.config.maxRunMinutes) {
      return `达到最大运行时间 (${this.config.maxRunMinutes}分钟)`
    }

    // 2. 检查自动转生
    if (this.config.autoRebirthEnabled && this.monster.difficultyValue >= 100) {
      return `达到自动转生条件 (难度值 >= 100)`
    }

    // 3. 检查是否卡关
    if (this.deathCount >= this.config.maxDeathCount) {
      return `连续死亡 ${this.deathCount} 次`
    }

    // 4. 检查是否停滞（20分钟无进展）
    if (this.stuckCheckTime > 0 && now - this.stuckCheckTime > this.config.maxStuckMinutes * 60000) {
      return `卡关超过 ${this.config.maxStuckMinutes} 分钟`
    }

    return null
  }

  private checkStuck() {
    if (this.monster.difficultyValue === this.lastDifficulty) {
      if (this.stuckCheckTime === 0) {
        this.stuckCheckTime = Date.now()
      }
    } else {
      this.stuckCheckTime = 0
      this.lastDifficulty = this.monster.difficultyValue
    }
  }

  // ============================================
  // 日志和指标收集
  // ============================================

  private logAction(type: PlayerAction['type'], details: Record<string, any>) {
    this.actions.push({
      type,
      timestamp: Date.now() - this.startTime,
      details
    })

    if (this.config.logLevel === 'verbose') {
      console.log(`[ACTION] ${type}:`, details)
    }
  }

  private logEvent(type: TestEvent['type'], message: string, details: Record<string, any> = {}) {
    this.events.push({
      timestamp: Date.now() - this.startTime,
      type,
      message,
      details
    })

    if (this.config.logLevel !== 'minimal') {
      console.log(`[EVENT] ${type}: ${message}`)
    }
  }

  private collectMetrics() {
    const now = Date.now()
    const elapsedSeconds = (now - this.startTime) / 1000

    // DPS采样
    const currentDPS = this.game.getDPS()
    this.metrics.dpsSamples.push(currentDPS)

    // 金币/秒采样
    const goldPerSecond = this.player.player.gold / elapsedSeconds
    this.metrics.goldPerSecond.push(goldPerSecond)

    // 经验/秒采样
    const expPerSecond = (this.player.player.experience + this.player.player.level * 100) / elapsedSeconds
    this.metrics.expPerSecond.push(expPerSecond)
  }

  // ============================================
  // 主循环
  // ============================================

  async run(): Promise<TestResult> {
    this.startTime = Date.now()
    this.lastDamageTime = this.startTime
    this.stuckCheckTime = 0
    this.running = true

    console.log('='.repeat(50))
    console.log('游戏测试模拟器启动')
    console.log(`配置:`, this.config)
    console.log('='.repeat(50))

    return new Promise((resolve) => {
      const intervalId = setInterval(() => {
        if (!this.running) {
          clearInterval(intervalId)
          return
        }

        // 检查终止条件
        const termination = this.checkTermination()
        if (termination) {
          this.running = false

          // 自动转生
          if (termination.includes('自动转生') && this.config.autoRebirthEnabled) {
            this.performRebirth()
          }

          const result = this.generateReport(termination)
          console.log('='.repeat(50))
          console.log('测试完成:', termination)
          console.log('='.repeat(50))
          resolve(result)
          return
        }

        // 执行战斗
        if (this.isInTrainingMode) {
          this.processTrainingBattle()
          this.metrics.timeSpentInTrainingMode += this.tickInterval
        } else {
          this.processMainBattle()
          this.metrics.timeSpentInMainMode += this.tickInterval
        }

        // 检查是否卡关
        this.checkStuck()
        if (this.stuckCheckTime > 0) {
          const stuckMinutes = Math.floor((Date.now() - this.stuckCheckTime) / 60000)
          if (stuckMinutes > 5 && stuckMinutes % 5 === 0) {
            this.logEvent('stuck_warning', `已卡关 ${stuckMinutes} 分钟`, {
              difficultyValue: this.monster.difficultyValue
            })
          }
        }

        // 做出决策
        this.decideAction()

        // 收集指标
        if (Math.random() < 0.1) { // 每秒约1次
          this.collectMetrics()
        }

        // 模拟升级检查
        const oldLevel = this.player.player.level
        this.player.addExperience(0) // 触发升级检查
        if (this.player.player.level > oldLevel) {
          this.logEvent('level_up', `升级到 Lv.${this.player.player.level}`, {
            level: this.player.player.level
          })
        }

        // 保存游戏（模拟）
        this.player.saveGame()

      }, this.tickInterval)
    })
  }

  // ============================================
  // 报告生成
  // ============================================

  private generateReport(terminationReason: string): TestResult {
    const endTime = Date.now()
    const duration = endTime - this.startTime

    // 计算平均DPS
    const avgDPS = this.metrics.dpsSamples.length > 0
      ? this.metrics.dpsSamples.reduce((a, b) => a + b, 0) / this.metrics.dpsSamples.length
      : 0

    // 计算平均金币收益
    const avgGoldPerSecond = this.metrics.goldPerSecond.length > 0
      ? this.metrics.goldPerSecond.reduce((a, b) => a + b, 0) / this.metrics.goldPerSecond.length
      : 0

    // 计算平均经验收益
    const avgExpPerSecond = this.metrics.expPerSecond.length > 0
      ? this.metrics.expPerSecond.reduce((a, b) => a + b, 0) / this.metrics.expPerSecond.length
      : 0

    return {
      finalStats: {
        difficultyValue: this.monster.difficultyValue,
        monsterLevel: this.monster.monsterLevel,
        playerLevel: this.player.player.level,
        gold: this.player.player.gold,
        diamond: this.player.player.diamond,
        totalDamage: this.game.damageStats.value.totalDamage,
        killCount: this.game.damageStats.value.killCount,
        rebirthCount: this.rebirth.totalRebirthCount
      },
      actions: this.actions,
      events: this.events,
      metrics: {
        ...this.metrics,
        averageSessionDamage: avgDPS * duration / 1000
      },
      terminationReason,
      duration
    }
  }

  // 导出日志文件
  exportLog(): string {
    const result = this.generateReport('手动结束')
    return JSON.stringify(result, null, 2)
  }

  // 分析结果
  analyzeResult(result: TestResult): string {
    const lines: string[] = []
    lines.push('='.repeat(60))
    lines.push('测试结果分析报告')
    lines.push('='.repeat(60))
    lines.push('')

    // 基本信息
    lines.push('【基本信息】')
    lines.push(`  运行时长: ${(result.duration / 60000).toFixed(1)} 分钟`)
    lines.push(`  终止原因: ${result.terminationReason}`)
    lines.push(`  转生次数: ${result.finalStats.rebirthCount}`)
    lines.push('')

    // 最终状态
    lines.push('【最终状态】')
    lines.push(`  难度值: ${result.finalStats.difficultyValue}`)
    lines.push(`  怪物等级: ${result.finalStats.monsterLevel}`)
    lines.push(`  玩家等级: ${result.finalStats.playerLevel}`)
    lines.push(`  金币: ${result.finalStats.gold.toLocaleString()}`)
    lines.push(`  钻石: ${result.finalStats.diamond.toLocaleString()}`)
    lines.push('')

    // 战斗统计
    lines.push('【战斗统计】')
    lines.push(`  总伤害: ${result.finalStats.totalDamage.toLocaleString()}`)
    lines.push(`  击杀数: ${result.finalStats.killCount.toLocaleString()}`)
    lines.push(`  行动次数: ${result.actions.length}`)
    lines.push('')

    // 性能指标
    const avgDPS = result.metrics.averageSessionDamage / (result.duration / 1000)
    lines.push('【性能指标】')
    lines.push(`  平均DPS: ${Math.floor(avgDPS).toLocaleString()}`)
    lines.push(`  金币收益: ${Math.floor(result.metrics.goldPerSecond.reduce((a, b) => a + b, 0) / Math.max(1, result.metrics.goldPerSecond.length) * 3600).toLocaleString()}/h`)
    lines.push(`  经验收益: ${Math.floor(result.metrics.expPerSecond.reduce((a, b) => a + b, 0) / Math.max(1, result.metrics.expPerSecond.length) * 3600).toLocaleString()}/h`)
    lines.push(`  主线时间占比: ${(result.metrics.timeSpentInMainMode / result.duration * 100).toFixed(1)}%`)
    lines.push(`  练功房时间占比: ${(result.metrics.timeSpentInTrainingMode / result.duration * 100).toFixed(1)}%`)
    lines.push('')

    // 伤害构成
    lines.push('【伤害构成】')
    const totalDamage = Object.values(result.metrics.damageBreakdown).reduce((a, b) => a + b, 0)
    for (const [type, damage] of Object.entries(result.metrics.damageBreakdown)) {
      const percent = totalDamage > 0 ? (damage / totalDamage * 100).toFixed(1) : '0.0'
      lines.push(`  ${type}: ${damage.toLocaleString()} (${percent}%)`)
    }
    lines.push('')

    // 事件摘要
    lines.push('【事件摘要】')
    const eventCounts = new Map<string, number>()
    for (const event of result.events) {
      eventCounts.set(event.type, (eventCounts.get(event.type) || 0) + 1)
    }
    for (const [type, count] of eventCounts) {
      lines.push(`  ${type}: ${count}次`)
    }
    lines.push('')

    // 行动摘要
    lines.push('【行动摘要】')
    const actionCounts = new Map<string, number>()
    for (const action of result.actions) {
      actionCounts.set(action.type, (actionCounts.get(action.type) || 0) + 1)
    }
    for (const [type, count] of actionCounts) {
      lines.push(`  ${type}: ${count}次`)
    }
    lines.push('')

    // 建议
    lines.push('【优化建议】')
    if (avgDPS < 100) {
      lines.push('  - DPS较低，建议优先升级攻击属性')
    }
    if (result.metrics.timeSpentInTrainingMode / result.duration > 0.5) {
      lines.push('  - 练功房时间过长，建议检查主线难度是否过难')
    }
    if (result.finalStats.playerLevel < 10) {
      lines.push('  - 玩家等级较低，建议先在练功房刷到10级')
    }
    if (actionCounts.get('lottery10') || 0 < 5) {
      lines.push('  - 抽卡次数较少，金币利用不充分')
    }

    lines.push('')
    lines.push('='.repeat(60))

    return lines.join('\n')
  }
}

// ============================================
// 运行测试
// ============================================

async function runTest() {
  const simulator = new GameSimulator({
    maxStuckMinutes: 20,
    maxDeathCount: 10,
    maxRunMinutes: 30,
    autoRebirthEnabled: true,
    logLevel: 'normal'
  })

  const result = await simulator.run()

  // 生成分析报告
  const analysis = simulator.analyzeResult(result)
  console.log('\n' + analysis)

  // 导出JSON日志
  const jsonLog = simulator.exportLog()

  // 保存日志文件
  const fs = require('fs')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = `./test-logs/test-${timestamp}.json`
  const reportPath = `./test-logs/test-${timestamp}-report.txt`

  try {
    fs.mkdirSync('./test-logs', { recursive: true })
    fs.writeFileSync(logPath, jsonLog)
    fs.writeFileSync(reportPath, analysis)
    console.log(`\n日志已保存到: ${logPath}`)
    console.log(`报告已保存到: ${reportPath}`)
  } catch (e) {
    console.log('\n无法保存日志文件:', e)
    console.log('JSON日志:\n', jsonLog)
  }

  return result
}

// 导出类供外部使用
export { GameSimulator, TestResult, TestConfig }

// 如果直接运行此脚本
if (require.main === module) {
  runTest().catch(console.error)
}
