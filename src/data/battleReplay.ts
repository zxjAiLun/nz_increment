export interface BattleReplayEvent {
  turn: number
  timestamp: number
  type: 'player_attack' | 'enemy_attack' | 'skill' | 'buff' | 'damage'
  actor: 'player' | 'enemy'
  description: string
  damage?: number
  heal?: number
}

export interface BattleReplay {
  id: string
  battleId: string
  playerId: string
  startTime: number
  endTime: number
  result: 'victory' | 'defeat'
  floor: number
  events: BattleReplayEvent[]
  finalPlayerHp: number
  finalEnemyHp: number
}
