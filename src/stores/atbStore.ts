import { defineStore } from 'pinia'

// T22.5 ATB Store - 使用选项式API保证类型推断正确
export const useATBStore = defineStore('atb', {
  state: () => ({
    /** 玩家ATB值 0-100，100时行动 */
    playerATB: 0 as number,
    /** 怪物ATB值 0-100，100时行动 */
    monsterATB: 0 as number,
    /** 当前行动者 */
    turnOrder: null as 'player' | 'monster' | null,
    /** ATB是否暂停 */
    isPaused: false as boolean,
    /** ATB速度倍率 */
    speedMultiplier: 1.0 as number,
    /** 上次更新的时间戳 */
    lastUpdateTime: 0 as number,
  }),
  actions: {
    reset() {
      this.playerATB = 0
      this.monsterATB = 0
      this.turnOrder = null
      this.isPaused = false
      this.lastUpdateTime = Date.now()
    },
    setPlayerATB(value: number) {
      this.playerATB = value
    },
    setMonsterATB(value: number) {
      this.monsterATB = value
    },
    setTurnOrder(turn: 'player' | 'monster' | null) {
      this.turnOrder = turn
    },
    pauseATB() {
      this.isPaused = true
    },
    resumeATB() {
      this.isPaused = false
      this.lastUpdateTime = Date.now()
    },
    setSpeedMultiplier(multiplier: number) {
      this.speedMultiplier = Math.max(0.25, Math.min(4.0, multiplier))
    },
    // T93 更新ATB（基于速度差）
    updateATB(playerSpeed: number, monsterSpeed: number, deltaTime: number) {
      if (this.isPaused) return
      
      const adjustedDelta = deltaTime * this.speedMultiplier
      // ATB充能速率 = 速度 * 0.01 * deltaTime(秒)
      this.playerATB = Math.min(100, this.playerATB + playerSpeed * 0.01 * adjustedDelta / 1000)
      this.monsterATB = Math.min(100, this.monsterATB + monsterSpeed * 0.01 * adjustedDelta / 1000)
      
      this.lastUpdateTime = Date.now()
    },
    // T93 获得行动权后重置ATB
    consumeTurn(who: 'player' | 'monster') {
      if (who === 'player') {
        this.playerATB = 0
      } else {
        this.monsterATB = 0
      }
    },
    // T93 获取当前ATB百分比
    getATBPercent(who: 'player' | 'monster'): number {
      return who === 'player' ? this.playerATB : this.monsterATB
    },
  }
})
