export interface BreakthroughMaterial {
  id: string
  name: string
  setId: string
  tier: number   // 1/2/3 对应突破等级
}

export const BREAKTHROUGH_MATERIALS: BreakthroughMaterial[] = [
  // berserker
  { id: 'berserker_shard_1', name: '狂战士碎片', setId: 'berserker', tier: 1 },
  { id: 'berserker_shard_2', name: '狂战士精华', setId: 'berserker', tier: 2 },
  { id: 'berserker_shard_3', name: '狂战士神核', setId: 'berserker', tier: 3 },
  // guardian
  { id: 'guardian_shard_1', name: '守护者碎片', setId: 'guardian', tier: 1 },
  { id: 'guardian_shard_2', name: '守护者精华', setId: 'guardian', tier: 2 },
  { id: 'guardian_shard_3', name: '守护者神核', setId: 'guardian', tier: 3 },
  // sorcerer
  { id: 'sorcerer_shard_1', name: '巫师碎片', setId: 'sorcerer', tier: 1 },
  { id: 'sorcerer_shard_2', name: '巫师精华', setId: 'sorcerer', tier: 2 },
  { id: 'sorcerer_shard_3', name: '巫师神核', setId: 'sorcerer', tier: 3 },
  // assassin
  { id: 'assassin_shard_1', name: '刺客碎片', setId: 'assassin', tier: 1 },
  { id: 'assassin_shard_2', name: '刺客精华', setId: 'assassin', tier: 2 },
  { id: 'assassin_shard_3', name: '刺客神核', setId: 'assassin', tier: 3 },
  // paladin
  { id: 'paladin_shard_1', name: '圣骑士碎片', setId: 'paladin', tier: 1 },
  { id: 'paladin_shard_2', name: '圣骑士精华', setId: 'paladin', tier: 2 },
  { id: 'paladin_shard_3', name: '圣骑士神核', setId: 'paladin', tier: 3 },
]
