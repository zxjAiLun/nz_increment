export interface Blessing {
  id: string
  name: string
  description: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  effect: { stat: string; value: number; type: 'flat' | 'percent' }[]
}

export interface Curse {
  id: string
  name: string
  description: string
  effect: { stat: string; value: number }
}

export interface Relic {
  id: string
  name: string
  description: string
  rarity: 'common' | 'rare' | 'epic' | 'legend'
  passive: string
}

export interface RoguelikeRun {
  currentFloor: number
  maxFloor: number
  blessings: Blessing[]
  curses: Curse[]
  relics: Relic[]
  score: number
  status: 'active' | 'failed' | 'completed'
}
