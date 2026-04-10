export interface BossRushEntry {
  bossId: string
  name: string
  maxHp: number
  attack: number
  defense: number
  phase: number        // 阶段数
  enrageTurns: number  //狂暴回合数
  difficulty: number
}

export const BOSS_RUSH_BOSSES: BossRushEntry[] = [
  { bossId: 'br_1', name: '黑暗先锋', maxHp: 50000, attack: 800, defense: 200, phase: 2, enrageTurns: 10, difficulty: 1 },
  { bossId: 'br_2', name: '地狱三头犬', maxHp: 80000, attack: 1200, defense: 350, phase: 3, enrageTurns: 8, difficulty: 2 },
  { bossId: 'br_3', name: '虚空领主', maxHp: 120000, attack: 1600, defense: 500, phase: 3, enrageTurns: 7, difficulty: 3 },
  { bossId: 'br_4', name: '永恒巨龙', maxHp: 200000, attack: 2200, defense: 800, phase: 4, enrageTurns: 6, difficulty: 5 },
  { bossId: 'br_5', name: '混沌之神', maxHp: 500000, attack: 3500, defense: 1200, phase: 5, enrageTurns: 5, difficulty: 10 },
]

export interface BossRushScore {
  bossId: string
  clearTime: number    // 秒
  damageDealt: number
  comboCount: number
  score: number
}
