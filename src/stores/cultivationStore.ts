import { defineStore } from 'pinia'
import { reactive, computed } from 'vue'
import type { CharacterCultivation } from '../types/character'
import type { PlayerStats } from '../types/index'
import { STAR_MULTIPLIERS, ASCENSION_BONUS, CONSTELLATION_TREE } from '../types/character'

const CULTIVATION_KEY = 'nz_cultivation_v1'

export const useCultivationStore = defineStore('cultivation', () => {
  const cultivation = reactive<CharacterCultivation>({
    starLevel: 1,
    ascensionPhase: 0,
    constellationNodes: [false, false, false, false, false, false],
    starExp: 0
  })

  // 计算星级倍率
  const starMultiplier = computed(() => STAR_MULTIPLIERS[cultivation.starLevel])
  const ascensionMultiplier = computed(() => ASCENSION_BONUS[cultivation.ascensionPhase])

  // 应用养成属性到基础属性
  function applyCultivation(baseStats: PlayerStats): PlayerStats {
    const mult = starMultiplier.value * ascensionMultiplier.value
    const result = { ...baseStats }
    for (const key of ['attack', 'defense', 'maxHp', 'speed'] as const) {
      if (key in result) {
        result[key] = Math.floor(result[key] * mult)
      }
    }
    return result
  }

  // 解锁命座节点
  function unlockConstellationNode(position: number): boolean {
    if (cultivation.constellationNodes[position - 1]) return false
    cultivation.constellationNodes[position - 1] = true
    save()
    return true
  }

  // 判断节点是否已解锁
  function isNodeUnlocked(position: number): boolean {
    return cultivation.constellationNodes[position - 1]
  }

  // 应用命座效果
  function getConstellationBonus(): Record<string, number> {
    const bonus: Record<string, number> = {}
    for (let i = 0; i < 6; i++) {
      if (cultivation.constellationNodes[i]) {
        const node = CONSTELLATION_TREE[i]
        if (node.passiveEffect.stat && node.passiveEffect.value) {
          bonus[node.passiveEffect.stat] = (bonus[node.passiveEffect.stat] || 0) + node.passiveEffect.value
        }
      }
    }
    return bonus
  }

  function save() {
    localStorage.setItem(CULTIVATION_KEY, JSON.stringify(cultivation))
  }

  function load() {
    const data = localStorage.getItem(CULTIVATION_KEY)
    if (data) {
      const parsed = JSON.parse(data) as CharacterCultivation
      // Clamp values to valid ranges to handle corrupted save data
      parsed.starLevel = Math.max(1, Math.min(6, parsed.starLevel || 1))
      parsed.ascensionPhase = Math.max(0, Math.min(6, parsed.ascensionPhase || 0))
      if (!Array.isArray(parsed.constellationNodes) || parsed.constellationNodes.length !== 6) {
        parsed.constellationNodes = [false, false, false, false, false, false]
      }
      Object.assign(cultivation, parsed)
    }
  }

  load()

  return {
    cultivation,
    starMultiplier,
    ascensionMultiplier,
    applyCultivation,
    unlockConstellationNode,
    isNodeUnlocked,
    getConstellationBonus,
    save,
    load
  }
})
