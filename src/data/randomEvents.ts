export type EventType = 'chest' | 'merchant' | 'trap' | 'blessing' | 'mystery'

export interface RandomEvent {
  id: string
  type: EventType
  name: string
  description: string
  effect: { gold?: number; diamond?: number; hp?: number; buff?: string; debuff?: string }
  probability: number  // 0-1, 权重
}

export const RANDOM_EVENTS: RandomEvent[] = [
  { id: 'chest_gold', type: 'chest', name: '黄金宝箱', description: '发现一个宝箱！', effect: { gold: 200 }, probability: 0.15 },
  { id: 'chest_diamond', type: 'chest', name: '钻石宝箱', description: '发现一个钻石箱！', effect: { diamond: 10 }, probability: 0.05 },
  { id: 'merchant_cheap', type: 'merchant', name: '神秘商人', description: '打折商品出售', effect: { gold: -100 }, probability: 0.12 },
  { id: 'merchant_expensive', type: 'merchant', name: '黑心商人', description: '高价收购你的物品', effect: { gold: 150 }, probability: 0.08 },
  { id: 'trap_poison', type: 'trap', name: '毒陷阱', description: '地上有毒！', effect: { hp: -50 }, probability: 0.15 },
  { id: 'trap_curse', type: 'trap', name: '诅咒陷阱', description: '被诅咒了...', effect: { debuff: 'curse' }, probability: 0.10 },
  { id: 'blessing_speed', type: 'blessing', name: '速度祝福', description: '获得速度提升！', effect: { buff: 'speed_up' }, probability: 0.12 },
  { id: 'blessing_power', type: 'blessing', name: '力量祝福', description: '攻击力提升！', effect: { buff: 'attack_up' }, probability: 0.12 },
  { id: 'mystery_box', type: 'mystery', name: '神秘盒子', description: '里面是什么？', effect: { diamond: 5, gold: 50 }, probability: 0.11 },
]
