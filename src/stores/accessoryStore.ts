import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// T85 配饰类型
export type AccessoryType = 'ring' | 'necklace' | 'bracelet' | 'anklet' | 'earring'

// T85 配饰稀有度
export type AccessoryRarity = 'common' | 'rare' | 'epic' | 'legend' | 'mythic'

// T85 配饰定义
export interface Accessory {
  id: string
  name: string
  type: AccessoryType
  rarity: AccessoryRarity
  stats: {
    attack?: number
    defense?: number
    maxHp?: number
    critRate?: number
    critDamage?: number
    lifesteal?: number
  }
  level: number
  exp: number
  setId?: string  // 所属套装
}

// T85 配饰套装
export interface AccessorySet {
  id: string
  name: string
  pieces: AccessoryType[]
  bonuses: { pieceCount: number; stat: string; value: number }[]
}

// T85 配饰套装数据
export const ACCESSORY_SETS: AccessorySet[] = [
  {
    id: 'set_dragon',
    name: '龙之守护',
    pieces: ['ring', 'necklace', 'bracelet'],
    bonuses: [
      { pieceCount: 2, stat: 'attack', value: 50 },
      { pieceCount: 3, stat: 'critRate', value: 10 },
    ],
  },
  {
    id: 'set_phoenix',
    name: '凤凰涅槃',
    pieces: ['ring', 'earring', 'anklet'],
    bonuses: [
      { pieceCount: 2, stat: 'maxHp', value: 500 },
      { pieceCount: 3, stat: 'lifesteal', value: 5 },
    ],
  },
]

// T85 配饰经验表
const EXP_TABLE = computed(() => {
  const table: number[] = [0]
  for (let i = 1; i <= 100; i++) {
    table[i] = table[i - 1] + Math.floor(50 * Math.pow(1.12, i))
  }
  return table
})

// T85 配饰升级所需经验
function getLevelUpExp(level: number): number {
  return EXP_TABLE.value[level] || 0
}

export const useAccessoryStore = defineStore('accessory', () => {
  // 已拥有的配饰
  const accessories = ref<Accessory[]>([])
  // 已佩戴的配饰
  const equipped = ref<Partial<Record<AccessoryType, string>>>({})
  // 升级经验表
  const expTable = EXP_TABLE

  // T85 生成随机配饰
  function generateAccessory(type?: AccessoryType): Accessory {
    const types: AccessoryType[] = ['ring', 'necklace', 'bracelet', 'anklet', 'earring']
    const rarities: AccessoryRarity[] = ['common', 'rare', 'epic', 'legend', 'mythic']
    
    const selectedType = type || types[Math.floor(Math.random() * types.length)]
    const rarityRoll = Math.random()
    let rarity: AccessoryRarity
    if (rarityRoll < 0.5) rarity = 'common'
    else if (rarityRoll < 0.8) rarity = 'rare'
    else if (rarityRoll < 0.95) rarity = 'epic'
    else if (rarityRoll < 0.99) rarity = 'legend'
    else rarity = 'mythic'

    const accessory: Accessory = {
      id: `acc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: `${selectedType}_${rarity}`,
      type: selectedType,
      rarity,
      stats: generateStats(rarity),
      level: 1,
      exp: 0,
    }
    return accessory
  }

  function generateStats(rarity: AccessoryRarity): Accessory['stats'] {
    const multiplier = { common: 1, rare: 1.5, epic: 2, legend: 3, mythic: 5 }[rarity]
    return {
      attack: Math.floor((10 + Math.random() * 20) * multiplier),
      defense: Math.floor((5 + Math.random() * 10) * multiplier),
      maxHp: Math.floor((50 + Math.random() * 100) * multiplier),
      critRate: Math.floor((1 + Math.random() * 3) * multiplier * 10) / 10,
      critDamage: Math.floor((10 + Math.random() * 20) * multiplier),
      lifesteal: Math.floor((1 + Math.random() * 2) * multiplier * 10) / 10,
    }
  }

  // T85 获取已佩戴配饰的属性加成
  const equippedStats = computed(() => {
    const stats = { attack: 0, defense: 0, maxHp: 0, critRate: 0, critDamage: 0, lifesteal: 0 }
    
    for (const type in equipped.value) {
      const acc = accessories.value.find(a => a.id === equipped.value[type as AccessoryType])
      if (acc) {
        stats.attack += acc.stats.attack || 0
        stats.defense += acc.stats.defense || 0
        stats.maxHp += acc.stats.maxHp || 0
        stats.critRate += acc.stats.critRate || 0
        stats.critDamage += acc.stats.critDamage || 0
        stats.lifesteal += acc.stats.lifesteal || 0
      }
    }
    
    // T85 套装效果
    const equippedTypes = Object.values(equipped.value).map(id => accessories.value.find(a => a.id === id)?.type).filter(Boolean) as AccessoryType[]
    for (const set of ACCESSORY_SETS) {
      const matchedPieces = set.pieces.filter(p => equippedTypes.includes(p))
      for (const bonus of set.bonuses) {
        if (matchedPieces.length >= bonus.pieceCount) {
          if (bonus.stat === 'attack') stats.attack += bonus.value
          else if (bonus.stat === 'defense') stats.defense += bonus.value
          else if (bonus.stat === 'maxHp') stats.maxHp += bonus.value
          else if (bonus.stat === 'critRate') stats.critRate += bonus.value
          else if (bonus.stat === 'critDamage') stats.critDamage += bonus.value
          else if (bonus.stat === 'lifesteal') stats.lifesteal += bonus.value
        }
      }
    }
    
    return stats
  })

  // T85 佩戴配饰
  function equipAccessory(accessoryId: string): boolean {
    const acc = accessories.value.find(a => a.id === accessoryId)
    if (!acc) return false
    
    // 卸下同类型已佩戴配饰
    if (equipped.value[acc.type]) {
      const oldAcc = accessories.value.find(a => a.id === equipped.value[acc.type])
      if (oldAcc) {
        // 放回背包，不删除
      }
    }
    
    equipped.value[acc.type] = acc.id
    return true
  }

  // T85 卸下配饰
  function unequipAccessory(type: AccessoryType): void {
    delete equipped.value[type]
  }

  // T85 升级配饰
  function upgradeAccessory(accessoryId: string, expAmount: number): boolean {
    const acc = accessories.value.find(a => a.id === accessoryId)
    if (!acc) return false
    
    acc.exp += expAmount
    
    // 检查升级
    while (acc.exp >= getLevelUpExp(acc.level)) {
      acc.exp -= getLevelUpExp(acc.level)
      acc.level++
      // 升级时属性提升
      acc.stats.attack = Math.floor((acc.stats.attack || 0) * 1.1)
      acc.stats.defense = Math.floor((acc.stats.defense || 0) * 1.1)
      acc.stats.maxHp = Math.floor((acc.stats.maxHp || 0) * 1.1)
    }
    
    return true
  }

  // T85 获得新配饰
  function addAccessory(accessory: Accessory): void {
    accessories.value.push(accessory)
  }

  // T85 分解配饰获得材料
  function recycleAccessory(accessoryId: string): number {
    const acc = accessories.value.find(a => a.id === accessoryId)
    if (!acc) return 0
    
    // 卸下如果已佩戴
    for (const type in equipped.value) {
      if (equipped.value[type as AccessoryType] === accessoryId) {
        delete equipped.value[type as AccessoryType]
      }
    }
    
    // 移除配饰
    accessories.value = accessories.value.filter(a => a.id !== accessoryId)
    
    // 返回材料数量（基于稀有度和等级）
    const rarityValue = { common: 1, rare: 3, epic: 10, legend: 30, mythic: 100 }[acc.rarity]
    return rarityValue * acc.level
  }

  return {
    accessories,
    equipped,
    expTable,
    equippedStats,
    generateAccessory,
    equipAccessory,
    unequipAccessory,
    upgradeAccessory,
    addAccessory,
    recycleAccessory,
  }
})
