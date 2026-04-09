import { defineStore } from 'pinia'

export interface BattlePassReward {
  level: number
  free?: { type: 'gold' | 'material' | 'gachaTicket'; amount: number }
  premium?: { type: 'diamond' | 'passiveShard' | 'avatarFrame' | 'setPiece'; amount: number }
}

export const BATTLE_PASS_REWARDS: BattlePassReward[] = [
  { level: 1, free: { type: 'gold', amount: 100 }, premium: { type: 'diamond', amount: 10 } },
  { level: 5, free: { type: 'material', amount: 5 }, premium: { type: 'passiveShard', amount: 2 } },
  { level: 10, free: { type: 'gachaTicket', amount: 1 }, premium: { type: 'diamond', amount: 30 } },
  { level: 15, free: { type: 'gold', amount: 500 }, premium: { type: 'setPiece', amount: 1 } },
  { level: 20, free: { type: 'material', amount: 10 }, premium: { type: 'diamond', amount: 50 } },
  { level: 25, free: { type: 'gold', amount: 1000 }, premium: { type: 'avatarFrame', amount: 1 } },
  { level: 30, free: { type: 'gachaTicket', amount: 2 }, premium: { type: 'passiveShard', amount: 5 } },
  { level: 35, free: { type: 'gold', amount: 2000 }, premium: { type: 'diamond', amount: 80 } },
  { level: 40, free: { type: 'material', amount: 20 }, premium: { type: 'setPiece', amount: 2 } },
  { level: 45, free: { type: 'gold', amount: 3000 }, premium: { type: 'passiveShard', amount: 8 } },
  { level: 50, free: { type: 'gachaTicket', amount: 5 }, premium: { type: 'setPiece', amount: 5 } },
]
