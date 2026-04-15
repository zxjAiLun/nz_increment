export interface WorldBoss {
  id: string
  name: string
  maxHp: number
  attack: number
  defense: number
  phase: number
  enrageThreshold: number // 狂暴血量阈值
  rewards: { diamond: number; gold: number; reputation: number }
}

export const WORLD_BOSSES: WorldBoss[] = [
  {
    id: 'wb_dragon',
    name: '灭世巨龙',
    maxHp: 10000000,
    attack: 5000,
    defense: 2000,
    phase: 5,
    enrageThreshold: 0.1,
    rewards: { diamond: 500, gold: 100000, reputation: 200 },
  },
  {
    id: 'wb_demon_lord',
    name: '魔神之主',
    maxHp: 5000000,
    attack: 3000,
    defense: 1200,
    phase: 3,
    enrageThreshold: 0.15,
    rewards: { diamond: 300, gold: 50000, reputation: 100 },
  },
  {
    id: 'wb_phoenix',
    name: '永恒凤凰',
    maxHp: 3000000,
    attack: 2000,
    defense: 800,
    phase: 3,
    enrageThreshold: 0.2,
    rewards: { diamond: 200, gold: 30000, reputation: 50 },
  },
]
