import type { Challenge } from '../types/challenge'

const CHALLENGE_TEMPLATES: Omit<Challenge, 'id' | 'type' | 'resetInterval'>[] = [
  {
    name: '怪物猎人',
    description: '击败 30 个怪物',
    condition: { type: 'kill_monsters', target: 30 },
    reward: { type: 'gold', amount: 500 }
  },
  {
    name: '暴击专家',
    description: '暴击击杀 15 个怪物',
    condition: { type: 'crit_kills', target: 15 },
    reward: { type: 'diamond', amount: 10 }
  },
  {
    name: '连击狂热',
    description: '单次战斗达成 10 连击',
    condition: { type: 'combo_streak', target: 10 },
    reward: { type: 'gold', amount: 300 }
  },
  {
    name: '伤害爆表',
    description: '累计造成 10000 伤害',
    condition: { type: 'damage_dealt', target: 10000 },
    reward: { type: 'exp', amount: 100 }
  },
  {
    name: 'Boss克星',
    description: '击败 5 个Boss',
    condition: { type: 'boss_kills', target: 5 },
    reward: { type: 'diamond', amount: 20 }
  },
  {
    name: '技能大师',
    description: '使用技能 20 次',
    condition: { type: 'skills_used', target: 20 },
    reward: { type: 'gold', amount: 400 }
  },
  {
    name: '深渊探索者',
    description: '到达第 50 层',
    condition: { type: 'floor_reached', target: 50 },
    reward: { type: 'diamond', amount: 30 }
  },
]

export function generateDailyChallenges(): Challenge[] {
  const shuffled = [...CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 3).map((t, i) => ({
    ...t,
    id: `daily_${t.name}_${i}_${Date.now()}`,
    type: 'daily',
    resetInterval: 1
  }))
}

export function generateWeeklyChallenges(): Challenge[] {
  const shuffled = [...CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 5).map((t, i) => ({
    ...t,
    id: `weekly_${t.name}_${i}_${Date.now()}`,
    type: 'weekly',
    resetInterval: 7
  }))
}
