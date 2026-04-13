import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateId } from '../utils/calc'

// T70 地下城楼层状态
export type FloorStatus = 'locked' | 'available' | 'cleared' | 'current'

// T70 地下城楼层
export interface DungeonFloor {
  floor: number
  name: string
  description: string
  monsterCount: number      // 该层怪物数量
  totalHealth: number       // 该层总血量
  currentHealth: number     // 当前剩余血量
  status: FloorStatus
  rewards: FloorReward[]
  element: 'fire' | 'water' | 'wind' | 'dark' | 'none'  // 楼层元素属性
  bossAppears: boolean      // 每5层有BOSS
}

export interface FloorReward {
  type: 'gold' | 'diamond' | 'material' | 'equipment'
  id?: string
  name: string
  count: number
  rarity?: string
}

// T70 地下城进度记录
export interface DungeonProgress {
  playerId: string
  highestFloor: number
  totalCleared: number
  lastPlayedAt: number
}

const STORAGE_KEY = 'nz_dungeon_v1'
const FLOOR_DATA: Omit<DungeonFloor, 'status' | 'currentHealth'>[] = [
  { floor: 1, name: '迷雾森林', description: '新手冒险者的起点，怪物较弱', monsterCount: 3, totalHealth: 500, element: 'none', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 100 }] },
  { floor: 2, name: '古老废墟', description: '残垣断壁间隐藏着无数陷阱', monsterCount: 4, totalHealth: 800, element: 'none', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 150 }] },
  { floor: 3, name: '幽暗洞穴', description: '黑暗中的生物对入侵者虎视眈眈', monsterCount: 5, totalHealth: 1200, element: 'none', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 200 }] },
  { floor: 4, name: '危机沼泽', description: '有毒蒸汽弥漫，行动需格外小心', monsterCount: 5, totalHealth: 1800, element: 'water', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 300 }] },
  { floor: 5, name: '火焰领主', description: '第一层的守关BOSS，击败它解锁新层', monsterCount: 6, totalHealth: 5000, element: 'fire', bossAppears: true, rewards: [{ type: 'gold', name: '金币', count: 1000 }, { type: 'equipment', name: '精良装备', count: 1, rarity: 'fine' }] },
  { floor: 6, name: '冰霜之巅', description: '寒气刺骨，每一步都是考验', monsterCount: 6, totalHealth: 3000, element: 'water', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 500 }] },
  { floor: 7, name: '疾风峡谷', description: '风刃如刀，撕裂一切阻挡', monsterCount: 7, totalHealth: 4000, element: 'wind', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 600 }] },
  { floor: 8, name: '暗影森林', description: '阴影中潜伏着未知的恐惧', monsterCount: 8, totalHealth: 6000, element: 'dark', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 800 }] },
  { floor: 9, name: '雷霆深渊', description: '雷电交加，是勇者的试炼场', monsterCount: 9, totalHealth: 9000, element: 'wind', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 1200 }] },
  { floor: 10, name: '黑暗龙息', description: '传说巨龙的领地，传闻无人活着离开', monsterCount: 10, totalHealth: 20000, element: 'dark', bossAppears: true, rewards: [{ type: 'gold', name: '金币', count: 5000 }, { type: 'diamond', name: '钻石', count: 50 }, { type: 'equipment', name: '稀有装备', count: 1, rarity: 'epic' }] },
  // 11-20 继续深化
  { floor: 11, name: '亡灵墓穴', description: '亡者安息之地，打扰他们可不是好主意', monsterCount: 10, totalHealth: 15000, element: 'dark', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 2000 }] },
  { floor: 12, name: '水晶洞窟', description: '晶莹剔透的晶簇中藏有神秘力量', monsterCount: 11, totalHealth: 20000, element: 'water', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 2500 }] },
  { floor: 13, name: '熔岩地带', description: '滚烫的熔岩河流，温度极高', monsterCount: 12, totalHealth: 25000, element: 'fire', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 3000 }] },
  { floor: 14, name: '雷电领域', description: '天空被闪电撕裂，电网密布', monsterCount: 13, totalHealth: 30000, element: 'wind', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 3500 }] },
  { floor: 15, name: '炼狱炎魔', description: '第二层BOSS，炼狱之火锻造的恶魔', monsterCount: 14, totalHealth: 50000, element: 'fire', bossAppears: true, rewards: [{ type: 'gold', name: '金币', count: 8000 }, { type: 'diamond', name: '钻石', count: 80 }, { type: 'equipment', name: '史诗装备', count: 1, rarity: 'legend' }] },
  { floor: 16, name: '深渊蠕虫', description: '来自最深处的吞噬者', monsterCount: 15, totalHealth: 40000, element: 'dark', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 5000 }] },
  { floor: 17, name: '风暴之眼', description: '龙卷风的风眼，宁静却致命', monsterCount: 16, totalHealth: 50000, element: 'wind', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 6000 }] },
  { floor: 18, name: '极寒冰川', description: '万年寒冰封存着远古的力量', monsterCount: 17, totalHealth: 60000, element: 'water', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 7000 }] },
  { floor: 19, name: '虚空裂隙', description: '连接异次元的通道，危险万分', monsterCount: 18, totalHealth: 80000, element: 'dark', bossAppears: false, rewards: [{ type: 'gold', name: '金币', count: 10000 }] },
  { floor: 20, name: '末日巨龙', description: '终结之龙，传说它曾毁灭过一个文明', monsterCount: 20, totalHealth: 150000, element: 'dark', bossAppears: true, rewards: [{ type: 'gold', name: '金币', count: 20000 }, { type: 'diamond', name: '钻石', count: 200 }, { type: 'equipment', name: '传说装备', count: 1, rarity: 'myth' }] },
]

export const useDungeonStore = defineStore('dungeon', () => {
  const floors = ref<DungeonFloor[]>([])
  const currentFloor = ref(1)
  const progress = ref<DungeonProgress>({
    playerId: 'player',
    highestFloor: 1,
    totalCleared: 0,
    lastPlayedAt: Date.now(),
  })
  const dailyAttempts = ref(0)
  const lastDailyReset = ref(0)

  function initFloors() {
    floors.value = FLOOR_DATA.map(f => ({
      ...f,
      currentHealth: f.totalHealth,
      status: f.floor === 1 ? 'available' : f.floor === currentFloor.value ? 'current' : 'locked',
    }))
  }

  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.floors && data.floors.length > 0) {
          floors.value = data.floors
        } else {
          initFloors()
        }
        progress.value = data.progress || progress.value
        dailyAttempts.value = data.dailyAttempts || 0
        lastDailyReset.value = data.lastReset || 0
        checkDailyReset()
      } else {
        initFloors()
      }
    } catch { initFloors() }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        floors: floors.value,
        progress: progress.value,
        dailyAttempts: dailyAttempts.value,
        lastReset: lastDailyReset.value,
      }))
    } catch { /* silent */ }
  }

  // T70 每日重置
  function checkDailyReset() {
    const now = Date.now()
    const dayStart = new Date().setHours(0, 0, 0, 0)
    if (lastDailyReset.value < dayStart) {
      dailyAttempts.value = 0
      lastDailyReset.value = now
      save()
    }
  }

  // T70 挑战楼层
  function challengeFloor(floorNum: number, damage: number): boolean {
    const floor = floors.value.find(f => f.floor === floorNum)
    if (!floor) return false
    if (floor.status === 'locked') return false
    if (dailyAttempts.value >= 10) return false // 每日最多10次
    if (damage <= 0) return false

    dailyAttempts.value++
    floor.currentHealth = Math.max(0, floor.currentHealth - damage)

    if (floor.currentHealth <= 0) {
      floor.status = 'cleared'
      progress.value.totalCleared++
      progress.value.highestFloor = Math.max(progress.value.highestFloor, floorNum)
      progress.value.lastPlayedAt = Date.now()

      // 解锁下一层
      const nextFloor = floors.value.find(f => f.floor === floorNum + 1)
      if (nextFloor) {
        nextFloor.status = 'available'
      }
      // 如果是当前层，下一层变成current
      if (floor.status === 'current') {
        if (nextFloor) nextFloor.status = 'current'
      }
      // 每5层BOSS关，下一层设为current
      if (floorNum % 5 === 0 && nextFloor) {
        const afterBoss = floors.value.find(f => f.floor === floorNum + 1)
        if (afterBoss) afterBoss.status = 'current'
      }
    }
    save()
    return true
  }

  // T70 重置楼层（重新挑战）
  function resetFloor(floorNum: number): boolean {
    const floor = floors.value.find(f => f.floor === floorNum)
    if (!floor) return false
    floor.currentHealth = floor.totalHealth
    floor.status = floorNum <= progress.value.highestFloor + 1 ? 'available' : 'locked'
    save()
    return true
  }

  // T70 获取当前可挑战的楼层
  const availableFloors = computed(() =>
    floors.value.filter(f => f.status === 'available' || f.status === 'current')
  )

  // T70 获取楼层奖励
  function claimFloorReward(floorNum: number): FloorReward[] | null {
    const floor = floors.value.find(f => f.floor === floorNum)
    if (!floor || floor.status !== 'cleared') return null
    return floor.rewards
  }

  return {
    floors,
    currentFloor,
    progress,
    dailyAttempts,
    availableFloors,
    load,
    challengeFloor,
    resetFloor,
    claimFloorReward,
    checkDailyReset,
  }
})
