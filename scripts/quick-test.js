/**
 * 快速测试脚本
 * 使用方法：
 * 1. 直接粘贴到浏览器控制台运行，或
 * 2. 通过 <script src="./scripts/quick-test.js"> 自动加载
 */

function getDamageStats(gameStore) {
  return gameStore.damageStats?.value || gameStore.damageStats || {
    totalDamage: 0,
    normalDamage: 0,
    critDamage: 0,
    skillDamage: 0,
    voidDamage: 0,
    trueDamage: 0,
    killCount: 0
  }
}

// 创建测试运行器（立即创建，不依赖gameVM）
const testRunner = {
  config: {
    maxStuckMinutes: 20,
    maxDeathCount: 10,
    maxRunMinutes: 30,
    autoRebirthEnabled: true,
    tickInterval: 1000
  },
  running: false,
  startTime: 0,
  intervalId: null,
  actions: [],
  events: [],
  strategy: {
    deathCount: 0,
    lastDifficulty: 0,
    stuckTime: 0,
    isInTrainingMode: false
  },
  metrics: {
    dpsSamples: [],
    goldHistory: []
  },

  log(type, msg, data) {
    this.events.push({ t: Date.now() - this.startTime, type, msg, data })
    console.log(`[${type}] ${msg}`, data || '')
  },

  checkGameLoaded() {
    if (typeof window.gameVM === 'undefined') {
      console.error('游戏未加载，请先启动游戏 (npm run dev)')
      return false
    }
    return true
  },

  tick() {
    const vm = window.gameVM
    if (!vm) return

    const ps = vm.playerStore
    const ms = vm.monsterStore
    const gs = vm.gameStore
    const ts = vm.trainingStore
    const rs = vm.rebirthStore

    // 战斗处理
    if (!gs.isPaused) {
      if (gs.battleMode === 'battle' && ms.currentMonster) {
        const dmg = ps.totalStats.attack
        const result = ms.damageMonster(dmg)
        if (result.killed) {
          ps.addGold(result.goldReward)
          ps.addExperience(result.expReward)
          if (ps.isDead()) {
            ps.revive()
            this.strategy.deathCount++
            this.log('DEATH', `死亡 x${this.strategy.deathCount}`, { diff: ms.difficultyValue })
          }
        }
      } else if (gs.battleMode === 'training') {
        if (!ts.currentTrainingMonster) ts.spawnTrainingMonster()
        const dmg = ps.totalStats.attack
        const result = ts.damageTrainingMonster(dmg)
        if (result.killed) {
          ps.addGold(result.goldReward)
          ps.addExperience(result.expReward)
          if (result.statDrop) ps.addStatReward(result.statDrop.type, result.statDrop.value)
          // 检测秒杀并自动升级
          if (result.goldReward < ps.totalStats.attack * 0.1) {
            ts.autoUpgrade && ts.autoUpgrade()
          }
        }
      }
    }

    // 策略决策
    const gold = ps.player.gold
    const diff = ms.difficultyValue
    const dc = this.strategy.deathCount

    // 死亡切换练功房
    if (dc >= 3 && !this.strategy.isInTrainingMode) {
      gs.switchBattleMode('training')
      this.strategy.isInTrainingMode = true
      this.log('MODE', '切换练功房', { deathCount: dc })
    }

    // 抽奖
    const cost10 = ps.getLottery10Cost()
    if (gold >= cost10) {
      ps.doLottery10()
      this.actions.push({ t: Date.now() - this.startTime, a: 'lottery10' })
    } else {
      const cost1 = ps.getLotteryCost()
      if (gold >= cost1) {
        ps.doLottery()
        this.actions.push({ t: Date.now() - this.startTime, a: 'lottery' })
      }
    }

    // 升级属性
    const attackCost = ps.getUpgradeCost('attack')
    if (gold >= attackCost) {
      ps.upgradeStat('attack', attackCost)
      this.actions.push({ t: Date.now() - this.startTime, a: 'upgradeAttack' })
    }

    // 练功房升级防御
    if (this.strategy.isInTrainingMode) {
      const defCost = ps.getUpgradeCost('defense')
      if (gold >= defCost * 2) {
        ps.upgradeStat('defense', defCost)
        this.actions.push({ t: Date.now() - this.startTime, a: 'upgradeDefense' })
      }
    }

    // 金币充足返回主线
    if (this.strategy.isInTrainingMode && gold > cost10 * 0.5 && dc < 2) {
      gs.switchBattleMode('battle')
      this.strategy.isInTrainingMode = false
      this.log('MODE', '切换主线', {})
    }

    // 检查升级
    const oldLevel = ps.player.level
    ps.addExperience(0)
    if (ps.player.level > oldLevel) {
      this.log('LEVEL', `升级 Lv.${ps.player.level}`, {
        atk: ps.player.stats.attack,
        def: ps.player.stats.defense
      })
    }

    // 保存
    ps.saveGame()

    // 终止检查
    const elapsed = (Date.now() - this.startTime) / 60000
    if (elapsed >= this.config.maxRunMinutes) {
      this.stop(`超时 (${elapsed.toFixed(1)}分钟)`)
      return
    }
    if (this.config.autoRebirthEnabled && diff >= 100) {
      this.stop(`自动转生 (难度>=100)`)
      return
    }
    if (dc >= this.config.maxDeathCount) {
      this.stop(`死亡过多 (${dc}次)`)
      return
    }

    // 卡关检查
    if (diff === this.strategy.lastDifficulty) {
      if (!this.strategy.stuckTime) this.strategy.stuckTime = Date.now()
      else if ((Date.now() - this.strategy.stuckTime) / 60000 >= this.config.maxStuckMinutes) {
        this.stop(`卡关超时 (${this.config.maxStuckMinutes}分钟)`)
        return
      }
    } else {
      this.strategy.lastDifficulty = diff
      this.strategy.stuckTime = 0
    }

    // 进度输出
    if (this.actions.length % 30 === 0) {
      const mins = ((Date.now() - this.startTime) / 60000).toFixed(1)
      console.log(`[PROGRESS] ${mins}m | 难度:${diff} | 金:${ps.player.gold.toLocaleString()} | Lv.${ps.player.level} | 死亡:${dc}`)
    }
  },

  start() {
    if (this.running) {
      console.warn('测试已在运行中')
      return
    }

    if (!this.checkGameLoaded()) {
      console.error('游戏未加载，无法启动测试')
      return
    }

    console.clear()
    console.log('='.repeat(50))
    console.log('游戏测试启动')
    console.log('配置:', this.config)
    console.log('='.repeat(50))

    this.running = true
    this.startTime = Date.now()
    this.actions = []
    this.events = []
    this.strategy = {
      deathCount: 0,
      lastDifficulty: window.gameVM.monsterStore.difficultyValue,
      stuckTime: 0,
      isInTrainingMode: window.gameVM.gameStore.battleMode === 'training'
    }

    this.log('START', '测试开始', this.config)
    this.intervalId = setInterval(() => this.tick(), this.config.tickInterval)
  },

  stop(reason = '手动停止') {
    if (!this.running) return
    this.running = false
    clearInterval(this.intervalId)
    this.showReport(reason)
  },

  showReport(reason) {
    const vm = window.gameVM
    if (!vm) {
      console.error('游戏未加载')
      return
    }

    const ps = vm.playerStore
    const ms = vm.monsterStore
    const gs = vm.gameStore
    const rs = vm.rebirthStore

    const duration = Date.now() - this.startTime
    const stats = getDamageStats(gs)
    const totalDmg = stats.normalDamage + stats.critDamage + stats.skillDamage + stats.voidDamage + stats.trueDamage

    console.log('\n' + '='.repeat(60))
    console.log('测试结果报告')
    console.log('='.repeat(60))
    console.log(`\n【基本信息】`)
    console.log(`  运行时长: ${(duration / 60000).toFixed(1)} 分钟`)
    console.log(`  终止原因: ${reason}`)
    console.log(`  转生次数: ${rs.totalRebirthCount}`)
    console.log(`\n【最终状态】`)
    console.log(`  难度值: ${ms.difficultyValue}`)
    console.log(`  玩家等级: ${ps.player.level}`)
    console.log(`  金币: ${ps.player.gold.toLocaleString()}`)
    console.log(`  钻石: ${ps.player.diamond.toLocaleString()}`)
    console.log(`\n【战斗统计】`)
    console.log(`  总伤害: ${stats.totalDamage.toLocaleString()}`)
    console.log(`  击杀数: ${stats.killCount.toLocaleString()}`)
    console.log(`  行动次数: ${this.actions.length}`)
    console.log(`\n【伤害构成】`)
    if (totalDmg > 0) {
      console.log(`  普通: ${stats.normalDamage.toLocaleString()} (${(stats.normalDamage/totalDmg*100).toFixed(1)}%)`)
      console.log(`  暴击: ${stats.critDamage.toLocaleString()} (${(stats.critDamage/totalDmg*100).toFixed(1)}%)`)
      console.log(`  技能: ${stats.skillDamage.toLocaleString()} (${(stats.skillDamage/totalDmg*100).toFixed(1)}%)`)
    }
    console.log(`\n【事件统计】`)
    const counts = {}
    for (const e of this.events) counts[e.type] = (counts[e.type] || 0) + 1
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}次`)
    console.log(`\n【行动统计】`)
    const ac = {}
    for (const a of this.actions) ac[a.a] = (ac[a.a] || 0) + 1
    for (const [k, v] of Object.entries(ac)) console.log(`  ${k}: ${v}次`)
    console.log('\n' + '='.repeat(60))

    // 复制JSON到剪贴板
    const result = {
      config: this.config,
      reason,
      duration,
      finalStats: {
        difficultyValue: ms.difficultyValue,
        monsterLevel: ms.monsterLevel,
        playerLevel: ps.player.level,
        gold: ps.player.gold,
        diamond: ps.player.diamond,
        totalDamage: stats.totalDamage,
        killCount: stats.killCount,
        rebirthCount: rs.totalRebirthCount
      },
      actions: this.actions,
      events: this.events
    }
    navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(
      () => console.log('JSON已复制到剪贴板'),
      () => {}
    )
  },

  // 快捷方法
  setMinutes(mins) { this.config.maxRunMinutes = mins; return this },
  setDeaths(n) { this.config.maxDeathCount = n; return this },
  noRebirth() { this.config.autoRebirthEnabled = false; return this }
}

// 挂载到window
window.testRunner = testRunner

// 如果通过script标签加载，等待DOMContentLoaded后提示
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log(`
========================================
快速测试脚本已自动加载
========================================

使用方法:
  testRunner.setMinutes(30).setDeaths(5).noRebirth().start()
  testRunner.start()    // 开始测试
  testRunner.stop()     // 停止测试

快捷配置:
  testRunner.setMinutes(60)    // 运行60分钟
  testRunner.setDeaths(5)      // 死亡5次停止
  testRunner.noRebirth()       // 禁用自动转生
========================================
`)
  })
} else {
  console.log(`
========================================
快速测试脚本已加载
========================================

使用方法:
  testRunner.start()    // 开始测试
  testRunner.stop()     // 停止测试

快捷配置:
  testRunner.setMinutes(60)    // 运行60分钟
  testRunner.setDeaths(5)      // 死亡5次停止
  testRunner.noRebirth()       // 禁用自动转生
========================================
`)
}
