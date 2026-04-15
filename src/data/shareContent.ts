export interface ShareContent {
  id: string
  type: 'battle_victory' | 'achievement' | 'ranking' | 'equipment'
  title: string
  description: string
  imageUrl?: string
  shareCode: string
  timestamp: number
  stats?: Record<string, string | number>
}

export const SHARE_TEMPLATES = {
  battle_victory: {
    title: '战斗胜利',
    description: '我在地牢中取得了胜利！',
    icon: 'sword'
  },
  achievement: {
    title: '成就解锁',
    description: '我解锁了成就：{achievement_name}',
    icon: 'trophy'
  },
  ranking: {
    title: '排行榜荣誉',
    description: '我在排行榜上名列第{rank}名！',
    icon: 'medal'
  },
  equipment: {
    title: '装备展示',
    description: '看看我的强力装备！',
    icon: 'shield'
  }
}
