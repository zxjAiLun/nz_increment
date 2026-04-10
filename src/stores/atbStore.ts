/**
 * ATB (Active Time Battle) Store
 * 
 * 管理ATB状态：玩家ATB值、怪物ATB值、当前行动者
 */

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
  }),
  actions: {
    reset() {
      this.playerATB = 0
      this.monsterATB = 0
      this.turnOrder = null
    },
    setPlayerATB(value: number) {
      this.playerATB = value
    },
    setMonsterATB(value: number) {
      this.monsterATB = value
    },
    setTurnOrder(turn: 'player' | 'monster' | null) {
      this.turnOrder = turn
    }
  }
})
