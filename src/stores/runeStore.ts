import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// T94 符文类型
export type RuneType = 'attack' | 'defense' | 'health' | 'crit' | 'speed' | 'luck'

// T94 符文稀有度
export type RuneRarity = 'common' | 'rare' | 'epic' | 'legend'

// T94 符文定义
export interface Rune {
  id: string
  type: RuneType
  rarity: RuneRarity
  level: number
  exp: number
  statValue: number
  slotIndex: number  // 镶嵌的槽位，-1表示未镶嵌
}

// T94 符文套装
export interface RuneSet {
  id: string
  name: string
  types: RuneType[]
  bonus: { count: number; effect: string; stat?: { type: string; value: number } }[]
}

// T94 符文套装数据
export const RUNE_SETS: RuneSet[] = [
  {
    id: 'set_attack',
    name: '攻击套装',
    types: ['attack', 'attack', 'crit'],
    bonus: [
      { count: 2, effect: '攻击+5%', stat: { type: 'attack', value: 5 } },
      { count: 3, effect: '暴击伤害+20%', stat: { type: 'critDamage', value: 20 } },
    ],
  },
  {
    id: 'set_defense',
    name: '防御套装',
    types: ['defense', 'defense', 'health'],
    bonus: [
      { count: 2, effect: '防御+8%', stat: { type: 'defense', value: 8 } },
      { count: 3, effect: '减伤+10%', stat: { type: 'damageReduction', value: 10 } },
    ],
  },
  {
    id: 'set_life',
    name: '生命套装',
    types: ['health', 'health', 'luck'],
    bonus: [
      { count: 2, effect: '生命+10%', stat: { type: 'maxHp', value: 10 } },
      { count: 3, effect: '生命偷取+5%', stat: { type: 'lifesteal', value: 5 } },
    ],
  },
  {
    id: 'set_speed',
    name: '速度套装',
    types: ['speed', 'speed', 'crit'],
    bonus: [
      { count: 2, effect: '速度+10%', stat: { type: 'speed', value: 10 } },
      { count: 3, effect: '先攻率+15%', stat: { type: 'firstStrike', value: 15 } },
    ],
  },
]

// T94 符文经验表
const RUNE_EXP_TABLE = computed(() => {
  const table: number[] = [0]
  for (let i = 1; i <= 50; i++) {
    table[i] = table[i - 1] + Math.floor(20 * Math.pow(1.1, i))
  }
  return table
})

export const useRuneStore = defineStore('rune', () => {
  const runes = ref<Rune[]>([])
  const equippedRunes = ref<(Rune | null)[]>([null, null, null, null, null])  // 5个镶嵌槽
  const expTable = RUNE_EXP_TABLE

  // T94 生成随机符文
  function generateRune(): Rune {
    const types: RuneType[] = ['attack', 'defense', 'health', 'crit', 'speed', 'luck']
    
    const type = types[Math.floor(Math.random() * types.length)]
    const rarityRoll = Math.random()
    let rarity: RuneRarity
    if (rarityRoll < 0.6) rarity = 'common'
    else if (rarityRoll < 0.85) rarity = 'rare'
    else if (rarityRoll < 0.97) rarity = 'epic'
    else rarity = 'legend'

    const baseStat: Record<RuneType, number> = {
      attack: 10, defense: 8, health: 50, crit: 3, speed: 5, luck: 5,
    }
    const multiplier = { common: 1, rare: 1.5, epic: 2, legend: 3 }[rarity]

    return {
      id: `rune_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type,
      rarity,
      level: 1,
      exp: 0,
      statValue: Math.floor(baseStat[type] * multiplier),
      slotIndex: -1,
    }
  }

  // T94 镶嵌符文
  function equipRune(runeId: string, slotIndex: number): boolean {
    const rune = runes.value.find(r => r.id === runeId)
    if (!rune || slotIndex < 0 || slotIndex >= 5) return false
    
    // 如果该槽已有符文，先卸下
    if (equippedRunes.value[slotIndex]) {
      const oldRune = equippedRunes.value[slotIndex]!
      oldRune.slotIndex = -1
    }
    
    rune.slotIndex = slotIndex
    equippedRunes.value[slotIndex] = rune
    return true
  }

  // T94 卸下符文
  function unequipRune(slotIndex: number): Rune | null {
    const rune = equippedRunes.value[slotIndex]
    if (!rune) return null
    rune.slotIndex = -1
    equippedRunes.value[slotIndex] = null
    return rune
  }

  // T94 升级符文
  function upgradeRune(runeId: string, expAmount: number): boolean {
    const rune = runes.value.find(r => r.id === runeId)
    if (!rune) return false
    
    rune.exp += expAmount
    while (rune.exp >= expTable.value[rune.level] && rune.level < 50) {
      rune.exp -= expTable.value[rune.level]
      rune.level++
      rune.statValue = Math.floor(rune.statValue * 1.1)
    }
    return true
  }

  // T94 获取已激活的套装效果
  const activeSetEffects = computed(() => {
    const equipped = equippedRunes.value.filter(r => r !== null) as Rune[]
    const typeCount: Record<RuneType, number> = {
      attack: 0, defense: 0, health: 0, crit: 0, speed: 0, luck: 0,
    }
    
    for (const rune of equipped) {
      typeCount[rune.type]++
    }
    
    const effects: { setName: string; effect: string }[] = []
    for (const set of RUNE_SETS) {
      let matchCount = 0
      for (const type of set.types) {
        if (typeCount[type] > 0) {
          matchCount++
          typeCount[type]--
        }
      }
      
      for (const bonus of set.bonus) {
        if (matchCount >= bonus.count) {
          effects.push({ setName: set.name, effect: bonus.effect })
          break  // 只显示最高档效果
        }
      }
    }
    
    return effects
  })

  // T94 获取符文总属性加成
  const totalRuneStats = computed(() => {
    const stats = {
      attack: 0, defense: 0, maxHp: 0, critRate: 0, critDamage: 0,
      speed: 0, luck: 0, lifesteal: 0,
    }
    
    for (const rune of equippedRunes.value) {
      if (!rune) continue
      const value = rune.statValue * (1 + (rune.level - 1) * 0.05)
      switch (rune.type) {
        case 'attack': stats.attack += value; break
        case 'defense': stats.defense += value; break
        case 'health': stats.maxHp += value; break
        case 'crit': stats.critRate += value; break
        case 'speed': stats.speed += value; break
        case 'luck': stats.luck += value; break
      }
    }
    
    return stats
  })

  return {
    runes,
    equippedRunes,
    expTable,
    activeSetEffects,
    totalRuneStats,
    generateRune,
    equipRune,
    unequipRune,
    upgradeRune,
  }
})
