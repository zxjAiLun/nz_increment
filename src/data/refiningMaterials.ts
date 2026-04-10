/**
 * 精炼材料数据
 */

export interface RefiningMaterial {
  id: string
  name: string
  description: string
  dropSource: string[]
}

export const REFINING_MATERIALS: RefiningMaterial[] = [
  {
    id: 'refining_stone',
    name: '精炼石',
    description: '用于装备精炼的基础材料',
    dropSource: ['boss掉落', '公会副本']
  },
  {
    id: 'star_dust',
    name: '星尘',
    description: '高级精炼材料，用于+10以上精炼',
    dropSource: ['高级副本']
  },
  {
    id: 'moon_essence',
    name: '月华精华',
    description: '稀有精炼材料，用于+15精炼',
    dropSource: ['公会副本高级']
  },
]
