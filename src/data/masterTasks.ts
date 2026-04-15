import type { MasterTask } from '../types/master'

export const MASTER_TASKS: MasterTask[] = [
  { id: 't_clear_10', name: '徒弟历练', description: '带领徒弟通关10次副本', target: 10, type: 'dungeon_clear', reward: { teachingPower: 5, diamond: 10 } },
  { id: 't_boss_5', name: 'BOSS导师', description: '协助徒弟击败5个Boss', target: 5, type: 'boss_kill', reward: { teachingPower: 8, diamond: 20 } },
  { id: 't_gold_50k', name: '财富导师', description: '徒弟累计获取5万金币', target: 50000, type: 'gold_earned', reward: { teachingPower: 3, diamond: 5 } },
  { id: 't_floor_50', name: '探索导师', description: '徒弟到达第50层', target: 50, type: 'floor_reached', reward: { teachingPower: 10, diamond: 30 } },
]
