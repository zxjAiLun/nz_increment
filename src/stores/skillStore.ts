import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Skill, PassiveSkill, PlayerStats } from '../types'
import { PASSIVE_SKILLS } from '../types'
import { usePlayerStore } from './playerStore'

const PASSIVE_SAVE_KEY = 'lollipop_passive_skills'

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
    return cooldown === 0
  }
  
  function useSkill(skillIndex: number): Skill | null {
    const playerStore = usePlayerStore()
    const skills = playerStore.player.skills
    
    if (skillIndex < 0 || skillIndex >= skills.length) return null
    
    const skill = skills[skillIndex]
    if (!skill || skill.currentCooldown !== 0) return null
    
    skill.currentCooldown = skill.cooldown
    
    if (skill.type === 'heal' && skill.healPercent) {
      playerStore.healPercent(skill.healPercent)
    }
    
    if (skill.buffEffect) {
      playerStore.applyBuff(skill.buffEffect.stat, skill.buffEffect.percentBoost, skill.buffEffect.duration)
    }
    
    return skill
  }
  
  function getNextReadySkill(): { index: number, skill: Skill } | null {
    const skills = getPlayerSkills()
    
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i]
      if (skill && skill.currentCooldown === 0 && skill.type === 'damage') {
        return { index: i, skill }
      }
    }
    
    return null
  }
  
  function updateCooldowns(_deltaTime: number) {
    const playerStore = usePlayerStore()
    for (const skill of playerStore.player.skills) {
      if (skill && skill.currentCooldown > 0) {
        skill.currentCooldown = Math.max(0, skill.currentCooldown - 1)
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
