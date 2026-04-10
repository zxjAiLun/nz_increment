import { defineStore } from 'pinia'
import { ref } from 'vue'
import { NOVICE_GUIDE, type GuideStep } from '../data/noviceGuide'

export const FIRST_REWARD = { diamond: 100, gold: 1000 }

export const useGuideStore = defineStore('guide', () => {
  const GUIDE_KEY = 'nz_guide'
  const currentStep = ref(0)
  const isActive = ref(false)
  const completedSteps = ref<string[]>([])

  const steps = NOVICE_GUIDE

  function load() {
    const saved = localStorage.getItem(GUIDE_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      completedSteps.value = data.completedSteps || []
      currentStep.value = data.currentStep || 0
    }
  }

  function save() {
    localStorage.setItem(GUIDE_KEY, JSON.stringify({
      completedSteps: completedSteps.value,
      currentStep: currentStep.value
    }))
  }

  function startGuide() {
    isActive.value = true
    currentStep.value = 0
  }

  function nextStep() {
    const step = steps[currentStep.value]
    if (step && !completedSteps.value.includes(step.id)) {
      completedSteps.value.push(step.id)
    }
    if (currentStep.value < steps.length - 1) {
      currentStep.value++
    } else {
      isActive.value = false
    }
    save()
  }

  function skipGuide() {
    isActive.value = false
    for (const step of steps) {
      if (!completedSteps.value.includes(step.id)) {
        completedSteps.value.push(step.id)
      }
    }
    save()
  }

  function getCurrentStep(): GuideStep | null {
    if (!isActive.value) return null
    return steps[currentStep.value] || null
  }

  function isStepCompleted(stepId: string): boolean {
    return completedSteps.value.includes(stepId)
  }

  function hasCompletedGuide(): boolean {
    return completedSteps.value.length >= steps.length
  }

  load()
  return { currentStep, isActive, completedSteps, steps, startGuide, nextStep, skipGuide, getCurrentStep, isStepCompleted, hasCompletedGuide }
})
