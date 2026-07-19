import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Skill, PassiveSkill, PlayerStats } from '../types'
import { PASSIVE_SKILLS } from '../types'
import { usePlayerStore } from './playerStore'
import { selectAutoSkill } from '../utils/skillSystem'

const PASSIVE_SAVE_KEY = 'lollipop_passive_skills'
// 与 gameStore.COOLDOWN_READY_EPS 保持一致：冷却剩余 ≤1ms 视为就绪（连续语义，避免边界相位漏判）。
const COOLDOWN_READY_EPS = 1e-3

export const useSkillStore = defineStore('skill', () => {
  // Passive Skills
  const passiveSkills = ref<PassiveSkill[]>([])
  const unlockedPassiveIds = ref<Set<string>>(new Set())

  function loadPassiveState() {
    try {
      const saved = localStorage.getItem(PASSIVE_SAVE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        unlockedPassiveIds.value = new Set(data.unlockedIds || [])
        passiveSkills.value = PASSIVE_SKILLS.filter(s => unlockedPassiveIds.value.has(s.id))
      }
    } catch {}
  }

  function savePassiveState() {
    localStorage.setItem(PASSIVE_SAVE_KEY, JSON.stringify({
      unlockedIds: Array.from(unlockedPassiveIds.value)
    }))
  }

  function unlockPassiveSkill(id: string) {
    const skill = PASSIVE_SKILLS.find(s => s.id === id)
    if (!skill) return
    if (unlockedPassiveIds.value.has(id)) return
    unlockedPassiveIds.value.add(id)
    passiveSkills.value.push(skill)
    savePassiveState()
  }

  function isPassiveUnlocked(id: string): boolean {
    return unlockedPassiveIds.value.has(id)
  }

  function applyPassiveEffects(stats: PlayerStats): PlayerStats {
    const newStats = { ...stats }
    for (const skill of passiveSkills.value) {
      for (const effect of skill.effects) {
        if (effect.trigger !== 'always') continue
        if (effect.statBonus) {
          const stat = effect.statBonus.stat as keyof PlayerStats
          if (effect.statBonus.type === 'percent') {
            (newStats as any)[stat] *= (1 + effect.statBonus.value / 100)
          } else {
            (newStats as any)[stat] += effect.statBonus.value
          }
        }
      }
    }
    return newStats
  }

  // Initialize
  loadPassiveState()

  function getPlayerSkills(): (Skill | null)[] {
    const playerStore = usePlayerStore()
    return playerStore.player.skills
  }
  
  function getSkillCooldown(skillIndex: number): number {
    const skills = getPlayerSkills()
    if (skillIndex < 0 || skillIndex >= skills.length) return 0
    const skill = skills[skillIndex]
    return skill ? skill.currentCooldown : 0
  }
  
  function isSkillReady(skillIndex: number): boolean {
    const cooldown = getSkillCooldown(skillIndex)
    return cooldown <= COOLDOWN_READY_EPS
  }
  
  // 无副作用的可用性查询：仅校验技能存在且冷却为 0，返回该技能（不修改冷却、不应用 Buff/治疗）。
  // 真正释放技能必须由 gameStore.tryUsePlayerSkill / 自动战斗的事件驱动统一完成，
  // 否则会出现「useSkill 提前设冷却/应用 Buff，随后 executePlayerTurn 因 cooldown≠0 跳过、改打普攻」的双路径 bug（A2.4 P0）。
  function useSkill(skillIndex: number): Skill | null {
    const playerStore = usePlayerStore()
    const skills = playerStore.player.skills

    if (skillIndex < 0 || skillIndex >= skills.length) return null

    const skill = skills[skillIndex]
    if (!skill || skill.currentCooldown > COOLDOWN_READY_EPS) return null

    return skill
  }
  
  // 共用唯一自动选技策略 selectAutoSkill：按槽位从前到后、只选就绪的 damage 技能、
  // 不自动施放 Buff/heal、无可用伤害技能返回 null（退化普攻）。
  function getNextReadySkill(): { index: number, skill: Skill } | null {
    const skills = getPlayerSkills()
    return selectAutoSkill(
      skills,
      (s) => s != null && s.currentCooldown <= COOLDOWN_READY_EPS,
      (s) => s
    )
  }
  
  // 与 gameStore.updateSkillCooldowns 保持同一时间语义：以秒递减（deltaTimeMs 为毫秒）。
  function updateCooldowns(deltaTimeMs: number) {
    const playerStore = usePlayerStore()
    const deltaSeconds = deltaTimeMs / 1000
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - deltaSeconds)
      }
    }
  }
  
  return {
    getPlayerSkills,
    getSkillCooldown,
    isSkillReady,
    useSkill,
    getNextReadySkill,
    updateCooldowns,
    passiveSkills,
    unlockedPassiveIds,
    unlockPassiveSkill,
    isPassiveUnlocked,
    applyPassiveEffects
  }
})
