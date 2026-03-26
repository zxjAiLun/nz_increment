<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

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
    :style="{ left: popup.x + 'px', top: popup.y + 'px' }"
  >
    <span class="damage-value">{{ formatValue() }}</span>
    <span v-if="popup.type === 'crit'" class="crit-label">💥 暴击!</span>
  </div>
</template>

<style scoped>
.damage-popup {
  position: absolute;
  pointer-events: none;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}

.damage-value {
  font-size: 1.2rem;
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
  text-shadow: 0 0 4px var(--color-secondary), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-crit {
  color: var(--color-primary);
  text-shadow: 0 0 12px var(--color-primary), 0 0 20px var(--color-primary), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-crit .damage-value {
  font-size: 1.8rem;
}

.damage-true {
  color: var(--color-gold);
  text-shadow: 0 0 8px var(--color-gold), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-void {
  color: var(--color-accent);
  text-shadow: 0 0 12px var(--color-accent), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-skill {
  color: var(--color-accent-light);
  text-shadow: 0 0 10px var(--color-accent), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-heal {
  color: var(--color-success);
  text-shadow: 0 0 12px var(--color-success), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-heal .damage-value {
  font-size: 1.4rem;
}

.damage-miss {
  color: var(--color-text-muted);
  text-shadow: 0 0 4px var(--color-text-muted), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-miss .damage-value {
  font-style: italic;
}

.damage-lifesteal {
  color: #ff88ff;
  text-shadow: 0 0 10px #ff88ff, 0 2px 4px rgba(0, 0, 0, 0.5);
}

.damage-lifesteal .damage-value {
  font-size: 1.3rem;
}

@keyframes float-up {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1.2);
  }
  20% {
    transform: translateY(-10px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(-80px) scale(0.7);
  }
}

@keyframes crit-shake {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1.2);
  }
  10% {
    transform: translateY(-5px) scale(1.3) rotate(-3deg);
  }
  20% {
    transform: translateY(-15px) scale(1.5) rotate(3deg);
  }
  30% {
    transform: translateY(-20px) scale(1.4) rotate(-2deg);
  }
  50% {
    opacity: 1;
    transform: translateY(-30px) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translateY(-70px) scale(0.6);
  }
}

@keyframes fade-out {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  30% {
    opacity: 0.8;
    transform: translateY(-10px) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translateY(-30px) scale(0.9);
  }
}

@keyframes heal-float {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  20% {
    transform: translateY(-15px) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translateY(-60px) scale(0.8);
  }
}

@keyframes lifesteal-float {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  15% {
    transform: translateY(-10px) scale(1.15);
  }
  100% {
    opacity: 0;
    transform: translateY(-50px) scale(0.8);
  }
}
</style>
