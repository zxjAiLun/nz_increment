export interface BattleSpeedConfig {
  speedMultiplier: number    // 1, 2, 4
  animationDuration: number  // ms per frame
  autoMode: boolean
}

export const BATTLE_SPEEDS = [
  { multiplier: 1, label: '1x', duration: 500 },
  { multiplier: 2, label: '2x', duration: 250 },
  { multiplier: 4, label: '4x', duration: 100 },
]

export interface SkipTicket {
  id: string
  name: string
  description: string
  count: number
}
