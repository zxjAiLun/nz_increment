<script setup lang="ts">
import { computed, onMounted } from 'vue'

export interface DamagePopupData {
  id: number
  value: number
  type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss' | 'lifesteal'
  x: number
  y: number
}

const props = defineProps<{
  popup: DamagePopupData
}>()

const emit = defineEmits<{
  (e: 'remove', id: number): void
}>()

const offsetX = computed(() => {
  const base = Math.random() * 60 - 30
  return props.popup.x + base
})

const offsetY = computed(() => {
  return props.popup.y - 20
})

const animationClass = computed(() => {
  switch (props.popup.type) {
    case 'crit': return 'crit-shake'
    case 'miss': return 'fade-out'
    case 'heal': return 'heal-float'
    case 'lifesteal': return 'lifesteal-float'
    default: return 'float-up'
  }
})

const duration = computed(() => {
  switch (props.popup.type) {
    case 'crit': return 1200
    case 'miss': return 800
    case 'heal': return 1000
    case 'lifesteal': return 900
    default: return 800
  }
})

onMounted(() => {
  setTimeout(() => {
    emit('remove', props.popup.id)
  }, duration.value)
})

function getDamageClass(): string {
  switch (props.popup.type) {
    case 'crit': return 'damage-crit'
    case 'true': return 'damage-true'
    case 'void': return 'damage-void'
    case 'skill': return 'damage-skill'
    case 'heal': return 'damage-heal'
    case 'miss': return 'damage-miss'
    case 'lifesteal': return 'damage-lifesteal'
    default: return 'damage-normal'
  }
}

function getPrefix(): string {
  switch (props.popup.type) {
    case 'heal': return '+'
    case 'lifesteal': return '❤+'
    case 'miss': return ''
    default: return ''
  }
}

function formatValue(): string {
  if (props.popup.type === 'miss') {
    return '闪避'
  }
  if (props.popup.type === 'heal' || props.popup.type === 'lifesteal') {
    return getPrefix() + props.popup.value.toLocaleString()
  }
  return props.popup.value.toLocaleString()
}
</script>

<template>
  <div
    class="damage-popup"
    :class="[getDamageClass(), animationClass]"
    :style="{
      left: offsetX + 'px',
      top: offsetY + 'px'
    }"
  >
    <span class="damage-value">{{ formatValue() }}</span>
    <span v-if="popup.type === 'crit'" class="crit-label">💥 暴击!</span>
  </div>
</template>

<style scoped>
.damage-popup {
  position: fixed;
  z-index: 9500;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: bold;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  transform: translate(-50%, -50%);
}

.damage-value {
  font-size: 1.5rem;
  font-family: 'Arial Black', sans-serif;
}

.crit-label {
  font-size: 0.7rem;
  margin-top: 2px;
}

.float-up {
  animation: float-up 0.8s ease-out forwards;
}

.crit-shake {
  animation: crit-shake 1.2s ease-out forwards;
}

.fade-out {
  animation: fade-out 0.8s ease-out forwards;
}

.heal-float {
  animation: heal-float 1s ease-out forwards;
}

.lifesteal-float {
  animation: lifesteal-float 0.9s ease-out forwards;
}

.damage-normal {
  color: var(--color-secondary);
  text-shadow: 0 0 4px var(--color-secondary), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-crit {
  color: var(--color-primary);
  text-shadow: 0 0 12px var(--color-primary), 0 0 20px var(--color-primary), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-crit .damage-value {
  font-size: 2.5rem;
  animation: critPulse 0.3s ease-out;
}

@keyframes critPulse {
  0% {
    transform: scale(1.5);
  }
  100% {
    transform: scale(1);
  }
}

.damage-true {
  color: var(--color-gold);
  text-shadow: 0 0 8px var(--color-gold), 0 0 15px var(--color-gold), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-true .damage-value {
  font-size: 2rem;
}

.damage-void {
  color: var(--color-accent);
  text-shadow: 0 0 12px var(--color-accent), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-void .damage-value {
  font-size: 1.8rem;
}

.damage-skill {
  color: var(--color-accent-light);
  text-shadow: 0 0 10px var(--color-accent), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-skill .damage-value {
  font-size: 1.8rem;
}

.damage-heal {
  color: var(--color-success);
  text-shadow: 0 0 12px var(--color-success), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-heal .damage-value {
  font-size: 1.8rem;
}

.damage-miss {
  color: var(--color-text-muted);
  text-shadow: 0 0 4px var(--color-text-muted), 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-miss .damage-value {
  font-style: italic;
}

.damage-lifesteal {
  color: #ff88ff;
  text-shadow: 0 0 10px #ff88ff, 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-lifesteal .damage-value {
  font-size: 1.6rem;
}

@keyframes float-up {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(0.5);
  }
  20% {
    opacity: 1;
    transform: translate(-50%, -70%) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -150%) scale(0.8);
  }
}

@keyframes crit-shake {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.2);
  }
  10% {
    transform: translate(-50%, -60%) scale(1.4) rotate(-3deg);
  }
  20% {
    transform: translate(-50%, -80%) scale(1.6) rotate(3deg);
  }
  30% {
    transform: translate(-50%, -100%) scale(1.5) rotate(-2deg);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -120%) scale(1.3);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -180%) scale(0.7);
  }
}

@keyframes fade-out {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  30% {
    opacity: 0.8;
    transform: translate(-50%, -70%) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -120%) scale(0.9);
  }
}

@keyframes heal-float {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  20% {
    transform: translate(-50%, -70%) scale(1.15);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -140%) scale(0.85);
  }
}

@keyframes lifesteal-float {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  15% {
    transform: translate(-50%, -65%) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -130%) scale(0.85);
  }
}
</style>
