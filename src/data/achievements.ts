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
  // T72 地下城成就
  {
    id: 'ach_dungeon_5',
    category: 'endless',
    name: '地下城新丁',
    description: '通关第5层地下城',
    condition: { type: 'dungeon_floor', target: 5 },
    reward: { diamond: 20 }
  },
  {
    id: 'ach_dungeon_10',
    category: 'endless',
    name: '地下城征服者',
    description: '通关第10层地下城',
    condition: { type: 'dungeon_floor', target: 10 },
    reward: { diamond: 50, gold: 5000 }
  },
  {
    id: 'ach_dungeon_20',
    category: 'endless',
    name: '地下城霸主',
    description: '通关第20层地下城',
    condition: { type: 'dungeon_floor', target: 20 },
    reward: { diamond: 150, title: '地下城霸主' }
  },
  // T72 元素成就
  {
    id: 'ach_element_burn',
    category: 'special',
    name: '纵火专家',
    description: '触发灼烧反应100次',
    condition: { type: 'element_reaction', target: 100, element: 'burn' },
    reward: { diamond: 30 }
  },
  {
    id: 'ach_element_frozen',
    category: 'special',
    name: '冰霜掌控者',
    description: '触发冻结反应50次',
    condition: { type: 'element_reaction', target: 50, element: 'frozen' },
    reward: { diamond: 40 }
  },
  // T72 公会成就
  {
    id: 'ach_guild_donate',
    category: 'special',
    name: '公会贡献者',
    description: '向公会捐献10000金币',
    condition: { type: 'guild_donate', target: 10000 },
    reward: { diamond: 30 }
  },
  {
    id: 'ach_guild_raid_5',
    category: 'special',
    name: '副本征服者',
    description: '通关公会副本5次',
    condition: { type: 'guild_raid_complete', target: 5 },
    reward: { diamond: 50 }
  },
  // T72 社交成就
  {
    id: 'ach_friend_10',
    category: 'special',
    name: '社交达人',
    description: '拥有10个好友',
    condition: { type: 'friend_count', target: 10 },
    reward: { diamond: 20 }
  },
  {
    id: 'ach_trade_5',
    category: 'special',
    name: '交易商人',
    description: '完成5次交易',
    condition: { type: 'trade_complete', target: 5 },
    reward: { diamond: 30 }
  },
  // T72 师徒成就
  {
    id: 'ach_mentor_student',
    category: 'special',
    name: '良师益友',
    description: '成功带出1名学徒',
    condition: { type: 'apprentice_graduate', target: 1 },
    reward: { diamond: 50 }
  },
  // T72 冒险成就
  {
    id: 'ach_adventure_3',
    category: 'special',
    name: '冒险家',
    description: '完成3次冒险',
    condition: { type: 'adventure_complete', target: 3 },
    reward: { diamond: 40 }
  },
  // T72 速度击杀成就
  {
    id: 'ach_speedkill_10',
    category: 'speedKill',
    name: '闪电战士',
    description: '10秒内击杀怪物',
    condition: { type: 'speed_kill', target: 10 },
    reward: { diamond: 25 }
  },
  // T72 回归成就
  {
    id: 'ach_rebirth_5',
    category: 'rebirth',
    name: '轮回者',
    description: '转生5次',
    condition: { type: 'rebirth_count', target: 5 },
    reward: { diamond: 100, title: '轮回者' }
  },
]
