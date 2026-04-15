export interface ArenaEntry {
  odPlayerId: string
  name: string
  rank: number
  rating: number  // MMR
  win: number
  lose: number
}

export interface PvPMatch {
  id: string
  playerSide: 'attacker' | 'defender'
  opponentId: string
  status: 'matching' | 'ready' | 'fighting' | 'finished'
  rewards?: { diamond?: number; rating?: number }
}

export interface PvPSeason {
  id: string
  startTime: number
  endTime: number
  rewards: { rank: number; reward: { diamond?: number; title?: string } }[]
}
