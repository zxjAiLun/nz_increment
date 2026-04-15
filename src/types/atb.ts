/**
 * ATB (Active Time Battle) Type Definitions
 * 
 * ATB系统：速度决定行动顺序，ATB槽位填充到100时触发行动
 */

export interface ATBState {
  playerATB: number           // 0-100，100时行动
  monsterATB: number         // 0-100
  turnOrder: 'player' | 'monster' | null  // 当前行动者
}

export interface SpeedContext {
  playerSpeed: number
  monsterSpeed: number
  playerATB: number
  monsterATB: number
}

export interface SpeedAdvantage {
  doubleAction: boolean  // 速度2倍以上，额外攻击
  firstStrike: boolean   // 1.5-2倍，先手优势
}
