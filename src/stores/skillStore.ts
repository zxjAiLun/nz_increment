import { defineStore } from 'pinia'
import type { Skill } from '../types'
import { usePlayerStore } from './playerStore'

export const useSkillStore = defineStore('skill', () => {
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
    updateCooldowns
  }
})
