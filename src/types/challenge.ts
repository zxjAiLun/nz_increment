export type ChallengeType = 'daily' | 'weekly'

export interface ChallengeCondition {
  type: 'kill_monsters' | 'crit_kills' | 'combo_streak' |
        'damage_dealt' | 'gold_earned' | 'boss_kills' |
        'skills_used' | 'floor_reached'
  target: number
  current?: number  // runtime tracking
}

export interface ChallengeReward {
  type: 'diamond' | 'gold' | 'exp' | 'equipment'
  amount: number
}

export interface Challenge {
  id: string
  name: string
  description: string
  type: ChallengeType
  condition: ChallengeCondition
  reward: ChallengeReward
  resetInterval: number  // daily=1, weekly=7
}

export interface ChallengeProgress {
  challengeId: string
  progress: number
  completed: boolean
  claimed: boolean
}
