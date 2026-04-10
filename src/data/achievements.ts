import type { Achievement } from '../types/achievement'

export const ACHIEVEMENTS: Achievement[] = [
  // 战斗类
  {
    id: 'ach_kill_100',
    category: 'combat',
    name: '初出茅庐',
    description: '累计击杀100怪物',
    condition: { type: 'kill_count', target: 100 },
    reward: { diamond: 10 }
  },
  {
    id: 'ach_kill_1000',
    category: 'combat',
    name: '战场老兵',
    description: '累计击杀1000怪物',
    condition: { type: 'kill_count', target: 1000 },
    reward: { diamond: 50, title: '战场老兵' }
  },
  {
    id: 'ach_boss_10',
    category: 'combat',
    name: 'Boss克星',
    description: '累计击败10个Boss',
    condition: { type: 'boss_kills', target: 10 },
    reward: { diamond: 20 }
  },
  {
    id: 'ach_crit_200',
    category: 'combat',
    name: '暴击达人',
    description: '累计暴击200次',
    condition: { type: 'crit_count', target: 200 },
    reward: { diamond: 15 }
  },
  {
    id: 'ach_combo_30',
    category: 'combat',
    name: '连击之王',
    description: '达成30连击',
    condition: { type: 'combo_max', target: 30 },
    reward: { diamond: 25, avatarFrame: 'combo_king' }
  },
  // 收集类
  {
    id: 'ach_gold_100k',
    category: 'collection',
    name: '小有资产',
    description: '累计获取10万金币',
    condition: { type: 'gold_earned', target: 100000 },
    reward: { diamond: 30 }
  },
  {
    id: 'ach_gacha_50',
    category: 'collection',
    name: '抽卡爱好者',
    description: '累计抽卡50次',
    condition: { type: 'gacha_pulls', target: 50 },
    reward: { diamond: 20 }
  },
  {
    id: 'ach_equip_20',
    category: 'collection',
    name: '装备收藏家',
    description: '收集20件装备',
    condition: { type: 'equip_collected', target: 20 },
    reward: { diamond: 40 }
  },
  // 挑战类
  {
    id: 'ach_floor_50',
    category: 'challenge',
    name: '深渊探索者',
    description: '到达第50层',
    condition: { type: 'floor_reached', target: 50 },
    reward: { diamond: 30, title: '深渊探索者' }
  },
  {
    id: 'ach_floor_100',
    category: 'challenge',
    name: '深渊征服者',
    description: '到达第100层',
    condition: { type: 'floor_reached', target: 100 },
    reward: { diamond: 100, avatarFrame: 'abyss_conqueror', title: '深渊征服者' }
  },
]
