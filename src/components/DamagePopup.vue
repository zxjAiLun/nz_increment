<script setup lang="ts">
import { onMounted } from 'vue'

export interface DamagePopupData {
  id: number
  value: number
  type: 'normal' | 'crit' | 'true' | 'void' | 'skill' | 'heal' | 'miss' | 'lifesteal'
  x: number
  y: number
}

const props = defineProps<{
  popups: DamagePopupData[]
}>()

const emit = defineEmits<{
  (e: 'remove', id: number): void
}>()

function getDamageColor(type: string): string {
  const colors: Record<string, string> = {
    normal: '#ffffff',
    crit: '#ffd700',
    trueDamage: '#9932cc',
    true: '#9932cc',
    lifesteal: '#ff4444',
    heal: '#44ff44',
    miss: '#aaaaaa',
    void: '#9932cc',
    skill: '#66ccff',
  }
  return colors[type] || colors.normal
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function getAnimation(type: string): string {
  switch (type) {
    case 'crit': return 'crit-pop 0.6s ease-out forwards'
    case 'miss': return 'fade-out 0.8s ease-out forwards'
    case 'heal': return 'heal-pop 0.8s ease-out forwards'
    case 'lifesteal': return 'lifesteal-pop 0.9s ease-out forwards'
    case 'skill': return 'skill-pop 0.7s ease-out forwards'
    default: return 'float-up 0.8s ease-out forwards'
  }
}

function getDamageClass(type: string): string {
  return `popup-${type}`
}

function getPrefix(type: string): string {
  switch (type) {
    case 'heal': return '+'
    case 'lifesteal': return '\u2764+' // heart
    case 'miss': return ''
    default: return ''
  }
}

function formatValue(type: string, value: number): string {
  if (type === 'miss') return '\u95ea\u907f'
  return getPrefix(type) + formatNumber(value)
}

function getDuration(type: string): number {
  switch (type) {
    case 'crit': return 600
    case 'miss': return 800
    case 'heal': return 800
    case 'lifesteal': return 900
    case 'skill': return 700
    default: return 800
  }
}

onMounted(() => {
  // Auto-remove popups after their animation duration
  for (const popup of props.popups) {
    const duration = getDuration(popup.type)
    setTimeout(() => {
      emit('remove', popup.id)
    }, duration + 100)
  }
})
</script>

<template>
  <div class="damage-popup-container">
    <div
      v-for="popup in popups"
      :key="popup.id"
      class="damage-popup"
      :class="getDamageClass(popup.type)"
      :style="{
        left: popup.x + 'px',
        top: popup.y + 'px',
        color: getDamageColor(popup.type),
        animation: getAnimation(popup.type)
      }"
    >
      <span class="popup-value">{{ formatValue(popup.type, popup.value) }}</span>
      <span v-if="popup.type === 'crit'" class="crit-label">\ud83d\udca5\u66b4\u51fb!</span>
    </div>
  </div>
</template>

<style scoped>
.damage-popup-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1000;
}

.damage-popup {
  position: absolute;
  font-weight: bold;
  font-family: 'Arial Black', sans-serif;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.popup-value {
  font-size: 18px;
}

.crit-label {
  font-size: 12px;
  margin-top: 2px;
}

/* Color variants */
.popup-crit {
  color: #ffd700 !important;
  font-size: 28px;
  font-weight: 900;
  text-shadow: 0 0 10px #ffd700, 2px 2px 4px rgba(0, 0, 0, 0.9);
}

.popup-crit .popup-value {
  font-size: 28px;
}

.popup-heal {
  color: #44ff44 !important;
  text-shadow: 0 0 8px #44ff44, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-lifesteal {
  color: #ff4444 !important;
  text-shadow: 0 0 8px #ff4444, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-true {
  color: #9932cc !important;
  text-shadow: 0 0 8px #9932cc, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-void {
  color: #9932cc !important;
  text-shadow: 0 0 10px #9932cc, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-skill {
  color: #66ccff !important;
  text-shadow: 0 0 8px #66ccff, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-miss {
  color: #aaaaaa !important;
  text-shadow: 0 0 4px #aaaaaa, 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.popup-miss .popup-value {
  font-style: italic;
}

/* Animations */
@keyframes crit-pop {
  0% { transform: scale(0.5) translateY(0); opacity: 1; }
  20% { transform: scale(1.8) translateY(-10px); opacity: 1; }
  40% { transform: scale(1.5) translateY(-20px); opacity: 1; }
  70% { transform: scale(1.2) translateY(-35px); opacity: 0.8; }
  100% { transform: scale(1.0) translateY(-50px); opacity: 0; }
}

@keyframes float-up {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  50% { opacity: 1; }
  100% { transform: translateY(-40px) scale(0.9); opacity: 0; }
}

@keyframes fade-out {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  30% { opacity: 0.8; transform: translateY(-10px) scale(1.1); }
  100% { transform: translateY(-30px) scale(0.9); opacity: 0; }
}

@keyframes heal-pop {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  20% { transform: translateY(-15px) scale(1.1); opacity: 1; }
  100% { transform: translateY(-60px) scale(0.8); opacity: 0; }
}

@keyframes lifesteal-pop {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  15% { transform: translateY(-10px) scale(1.15); opacity: 1; }
  100% { transform: translateY(-50px) scale(0.8); opacity: 0; }
}

@keyframes skill-pop {
  0% { transform: translateY(0) scale(1.2); opacity: 1; }
  20% { transform: translateY(-10px) scale(1); opacity: 1; }
  100% { transform: translateY(-60px) scale(0.7); opacity: 0; }
}
</style>
