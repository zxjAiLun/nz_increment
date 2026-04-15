export interface MasterApprentice {
  role: 'master' | 'apprentice' | null
  masterId?: string
  apprenticeIds: string[]
  teachingPower: number  // 师父点数
  graduationProgress: number  // 徒弟出师进度
  rewardsClaimed: string[]
}

export interface MasterTask {
  id: string
  name: string
  description: string
  target: number
  type: 'dungeon_clear' | 'boss_kill' | 'gold_earned' | 'floor_reached'
  reward: { teachingPower?: number; diamond?: number }
}
