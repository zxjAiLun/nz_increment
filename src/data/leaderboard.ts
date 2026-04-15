export interface LeaderboardEntry {
  rank: number
  playerId: string
  playerName: string
  level: number
  totalPower: number   // 战力
  arenaRank: number
  floorReached: number
  lastUpdated: number
}

export interface LeaderboardSeason {
  id: string
  name: string
  startTime: number
  endTime: number
  rewards: { rank: number; reward: { diamond?: number; title?: string } }[]
}

export const SEASONS: LeaderboardSeason[] = [
  {
    id: 's1', name: 'S1赛季', startTime: Date.now(), endTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
    rewards: [
      { rank: 1, reward: { diamond: 1000, title: 'S1王者' } },
      { rank: 2, reward: { diamond: 500, title: 'S1宗师' } },
      { rank: 3, reward: { diamond: 300, title: 'S1大师' } },
      { rank: 10, reward: { diamond: 100 } },
      { rank: 100, reward: { diamond: 50 } },
    ]
  }
]

// 模拟排行榜数据
export function generateMockLeaderboard(): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = []
  const names = ['星之守护者', '暗夜刺客', '永恒龙骑', '雷霆战神', '冰霜女王', '烈焰剑圣', '月光弓神', '大地守护', '疾风剑豪', '深渊领主']
  for (let i = 0; i < 100; i++) {
    entries.push({
      rank: i + 1,
      playerId: `p${i}`,
      playerName: names[i % names.length] + (i > 9 ? `#${i}` : ''),
      level: 50 + Math.floor(Math.random() * 50),
      totalPower: 100000 - i * 800 + Math.floor(Math.random() * 1000),
      arenaRank: Math.max(1, 1000 - i * 8 + Math.floor(Math.random() * 20)),
      floorReached: 80 + Math.floor(Math.random() * 40),
      lastUpdated: Date.now() - Math.floor(Math.random() * 3600000)
    })
  }
  return entries
}
