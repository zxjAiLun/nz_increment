import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { generateId } from '../utils/calc'

// T70 冒险事件类型
export type AdventureEventType = 'combat' | 'treasure' | 'mystery' | 'rest' | 'elite' | 'boss' | 'shop' | 'event'

// T70 冒险路线节点
export interface AdventureNode {
  id: string
  type: AdventureEventType
  name: string
  description: string
  options: AdventureOption[]
  completed: boolean
  reward?: AdventureReward
}

export interface AdventureOption {
  text: string
  effects: AdventureEffect[]
  nextNodeId?: string
}

export interface AdventureEffect {
  type: 'damage' | 'heal' | 'gold' | 'buff' | 'debuff' | 'teleport'
  value: number
  description: string
}

export interface AdventureReward {
  gold?: number
  diamond?: number
  hp?: number
  buff?: string
}

// T70 冒险路线
export interface AdventureRun {
  id: string
  playerId: string
  nodes: AdventureNode[]
  currentNodeId: string
  playerHp: number
  playerMaxHp: number
  gold: number
  buffs: string[]
  startTime: number
  chaptersCompleted: number
  status: 'active' | 'completed' | 'failed'
  seed: number  // 随机种子，保证可重玩
}

const STORAGE_KEY = 'nz_adventure_v1'
const CHAPTER_SIZE = 7  // 每章节7个节点

// T70 生成冒险路线
function generateAdventurePath(seed: number, chapter: number): AdventureNode[] {
  const nodes: AdventureNode[] = []
  const rng = seededRandom(seed + chapter)

  const nodeTypes: AdventureEventType[] = ['combat', 'combat', 'combat', 'treasure', 'mystery', 'rest', 'elite', 'shop']

  for (let i = 0; i < CHAPTER_SIZE; i++) {
    const type = i === CHAPTER_SIZE - 1 ? 'boss' : nodeTypes[Math.floor(rng() * nodeTypes.length)]
    const node = createNode(type, i + 1, chapter, rng)
    nodes.push(node)
  }
  return nodes
}

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function createNode(type: AdventureEventType, step: number, chapter: number, rng: () => number): AdventureNode {
  const id = generateId()
  const baseDescriptions: Record<AdventureEventType, { name: string; desc: string }> = {
    combat: { name: '遭遇怪物', desc: '一只凶猛的怪物挡住了去路' },
    elite: { name: '精英遭遇', desc: '这是一场硬仗，击败它有丰厚奖励' },
    boss: { name: '章节BOSS', desc: '守关的BOSS极其强大！' },
    treasure: { name: '宝藏发现', desc: '前方有一个闪闪发光的宝箱' },
    mystery: { name: '神秘事件', desc: '命运的十字路口，选择将决定一切' },
    rest: { name: '休息营地', desc: '篝火旁可以恢复生命' },
    shop: { name: '神秘商人', desc: '商人在此摆摊，物品价格不菲' },
    event: { name: '随机事件', desc: '旅途中的意外插曲' },
  }

  const info = baseDescriptions[type]
  const options = createOptionsForNode(type, id, rng)

  return {
    id,
    type,
    name: `第${step}步 - ${info.name}`,
    description: info.desc,
    options,
    completed: false,
  }
}

function createOptionsForNode(type: AdventureEventType, nodeId: string, rng: () => number): AdventureOption[] {
  switch (type) {
    case 'combat':
    case 'elite':
    case 'boss':
      return [
        { text: '全力以赴', effects: [{ type: 'damage', value: 30 + Math.floor(rng() * 50), description: '受到伤害' }], nextNodeId: nodeId },
        { text: '谨慎进攻', effects: [{ type: 'damage', value: 15 + Math.floor(rng() * 20), description: '受到较少伤害' }], nextNodeId: nodeId },
      ]
    case 'treasure':
      return [
        { text: '打开宝箱', effects: [{ type: 'gold', value: 100 + Math.floor(rng() * 200), description: '获得金币' }], nextNodeId: nodeId },
        { text: '小心探查', effects: [{ type: 'gold', value: 50 + Math.floor(rng() * 100), description: '获得少量金币' }, { type: 'buff', value: 1, description: '获得增益' }], nextNodeId: nodeId },
      ]
    case 'rest':
      return [
        { text: '充分休息', effects: [{ type: 'heal', value: 50, description: '恢复50%最大生命' }], nextNodeId: nodeId },
        { text: '简单休整', effects: [{ type: 'heal', value: 25, description: '恢复25%最大生命' }], nextNodeId: nodeId },
      ]
    case 'shop':
      return [
        { text: '购买药水', effects: [{ type: 'gold', value: -50, description: '消耗50金币' }, { type: 'heal', value: 30, description: '恢复30生命' }], nextNodeId: nodeId },
        { text: '离开', effects: [], nextNodeId: nodeId },
      ]
    case 'mystery':
      return [
        { text: '接受挑战', effects: [{ type: 'damage', value: 20, description: '可能受伤' }, { type: 'gold', value: 100, description: '或获得金币' }], nextNodeId: nodeId },
        { text: '绕道而行', effects: [{ type: 'debuff', value: 1, description: '轻微减速' }], nextNodeId: nodeId },
      ]
    default:
      return [{ text: '继续前进', effects: [], nextNodeId: nodeId }]
  }
}

export const useAdventureStore = defineStore('adventure', () => {
  const currentRun = ref<AdventureRun | null>(null)
  const completedRuns = ref<AdventureRun[]>([])
  const totalRuns = ref(0)
  const bestChapter = ref(0)

  function load() {
    try {
      const raw = localStorage?.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        currentRun.value = data.currentRun || null
        completedRuns.value = data.completed || []
        totalRuns.value = data.totalRuns || 0
        bestChapter.value = data.bestChapter || 0
      }
    } catch { /* silent */ }
  }

  function save() {
    try {
      localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        currentRun: currentRun.value,
        completed: completedRuns.value,
        totalRuns: totalRuns.value,
        bestChapter: bestChapter.value,
      }))
    } catch { /* silent */ }
  }

  // T70 开始新冒险
  function startRun(playerId: string, maxHp: number): AdventureRun {
    const seed = Date.now()
    const chapter = bestChapter.value + 1
    const nodes = generateAdventurePath(seed, chapter)

    const run: AdventureRun = {
      id: generateId(),
      playerId,
      nodes,
      currentNodeId: nodes[0].id,
      playerHp: maxHp,
      playerMaxHp: maxHp,
      gold: 0,
      buffs: [],
      startTime: Date.now(),
      chaptersCompleted: 0,
      status: 'active',
      seed,
    }
    currentRun.value = run
    totalRuns.value++
    save()
    return run
  }

  // T70 选择选项
  function selectOption(optionIndex: number): boolean {
    if (!currentRun.value || currentRun.value.status !== 'active') return false
    const node = currentRun.value.nodes.find(n => n.id === currentRun.value!.currentNodeId)
    if (!node || node.completed) return false

    const option = node.options[optionIndex]
    if (!option) return false

    // 应用效果
    option.effects.forEach(effect => {
      switch (effect.type) {
        case 'damage':
          currentRun.value!.playerHp = Math.max(0, currentRun.value!.playerHp - effect.value)
          break
        case 'heal':
          currentRun.value!.playerHp = Math.min(currentRun.value!.playerMaxHp, currentRun.value!.playerHp + effect.value)
          break
        case 'gold':
          currentRun.value!.gold = Math.max(0, currentRun.value!.gold + effect.value)
          break
        case 'buff':
          if (!currentRun.value!.buffs.includes(effect.description)) {
            currentRun.value!.buffs.push(effect.description)
          }
          break
      }
    })

    node.completed = true
    node.reward = option.effects.reduce<AdventureReward>((acc, e) => {
      if (e.type === 'gold') acc.gold = (acc.gold || 0) + e.value
      if (e.type === 'heal') acc.hp = (acc.hp || 0) + e.value
      if (e.type === 'buff') acc.buff = e.description
      return acc
    }, {})

    // 检查失败
    if (currentRun.value.playerHp <= 0) {
      currentRun.value.status = 'failed'
      save()
      return true
    }

    // 移动到下一节点
    const currentIdx = node.options[optionIndex].nextNodeId
      ? currentRun.value.nodes.findIndex(n => n.id === currentRun.value!.currentNodeId)
      : currentRun.value.nodes.findIndex(n => n.id === currentRun.value!.currentNodeId)

    const nextNode = currentRun.value.nodes[currentIdx + 1]
    if (nextNode) {
      currentRun.value.currentNodeId = nextNode.id
    } else {
      // 章节完成
      currentRun.value.chaptersCompleted++
      if (currentRun.value.chaptersCompleted >= 3) {
        currentRun.value.status = 'completed'
        bestChapter.value = Math.max(bestChapter.value, currentRun.value.chaptersCompleted)
        completedRuns.value.unshift({ ...currentRun.value })
      } else {
        // 生成新章节
        const newNodes = generateAdventurePath(currentRun.value.seed + currentRun.value.chaptersCompleted, currentRun.value.chaptersCompleted + 1)
        currentRun.value.nodes.push(...newNodes)
        currentRun.value.currentNodeId = newNodes[0].id
        // BOSS后恢复一定血量
        currentRun.value.playerHp = Math.min(currentRun.value.playerMaxHp, currentRun.value.playerHp + Math.floor(currentRun.value.playerMaxHp * 0.3))
      }
    }
    save()
    return true
  }

  // T70 放弃冒险
  function abandonRun() {
    if (currentRun.value) {
      currentRun.value.status = 'failed'
      currentRun.value = null
      save()
    }
  }

  // T70 获取当前节点
  const currentNode = computed(() => {
    if (!currentRun.value) return null
    return currentRun.value.nodes.find(n => n.id === currentRun.value!.currentNodeId) || null
  })

  return {
    currentRun,
    completedRuns,
    totalRuns,
    bestChapter,
    currentNode,
    load,
    startRun,
    selectOption,
    abandonRun,
  }
})
