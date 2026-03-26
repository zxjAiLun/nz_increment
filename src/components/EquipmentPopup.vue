<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{
  equipment: any
  position?: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'remove'): void
  (e: 'click', equipment: any): void
}>()

const duration = ref(3000)

onMounted(() => {
  setTimeout(() => {
    emit('remove')
  }, duration.value)
})

function getRarityColor(): string {
  const rarity = props.equipment?.rarity || 'common'
  const colors: Record<string, string> = {
    common: '#9ca3af',
    uncommon: '#22c55e',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f59e0b'
  }
  return colors[rarity] || colors.common
}

function getRarityName(): string {
  const rarity = props.equipment?.rarity || 'common'
  const names: Record<string, string> = {
    common: '普通',
    uncommon: '优秀',
    rare: '稀有',
    epic: '史诗',
    legendary: '传说'
  }
  return names[rarity] || names.common
}

function handleClick() {
  emit('click', props.equipment)
  emit('remove')
}
</script>

<template>
  <div
    class="equipment-popup"
    :style="{
      left: (position?.x || 50) + 'px',
      top: (position?.y || 50) + 'px',
      '--rarity-color': getRarityColor()
    }"
    @click="handleClick"
  >
    <div class="popup-icon">
      <span class="icon-emoji">⚔️</span>
    </div>
    <div class="popup-content">
      <div class="popup-rarity" :style="{ color: getRarityColor() }">
        {{ getRarityName() }}
      </div>
      <div class="popup-name">
        {{ equipment?.name || '未知装备' }}
      </div>
      <div class="popup-label">
        获得装备
      </div>
    </div>
    <div class="popup-hint">
      点击查看详情
    </div>
  </div>
</template>

<style scoped>
.equipment-popup {
  position: fixed;
  transform: translate(-50%, -50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  background: linear-gradient(135deg, var(--color-bg-panel), var(--color-bg-card));
  border: 2px solid var(--rarity-color);
  border-radius: var(--border-radius-lg);
  padding: 1rem 1.2rem;
  box-shadow: 
    0 0 20px rgba(0, 0, 0, 0.5),
    0 0 40px color-mix(in srgb, var(--rarity-color) 30%, transparent);
  cursor: pointer;
  pointer-events: auto;
  animation: equipment-popup-appear 0.5s ease-out forwards;
}

.popup-icon {
  font-size: 2.5rem;
  line-height: 1;
}

.icon-emoji {
  filter: drop-shadow(0 0 8px var(--rarity-color));
}

.popup-content {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.popup-rarity {
  font-size: var(--font-size-xs);
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.popup-name {
  font-size: var(--font-size-lg);
  font-weight: bold;
  color: var(--color-text-primary);
  text-shadow: 0 0 10px var(--rarity-color);
}

.popup-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.popup-hint {
  position: absolute;
  bottom: -1.5rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--font-size-xs);
  color: var(--color-text-disabled);
  white-space: nowrap;
  opacity: 0;
  animation: hint-appear 0.3s ease-out 0.5s forwards;
}

@keyframes equipment-popup-appear {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.5) rotate(-10deg);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.1) rotate(2deg);
  }
  70% {
    transform: translate(-50%, -50%) scale(0.95) rotate(-1deg);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
  }
}

@keyframes hint-appear {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(-5px);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.equipment-popup:hover {
  transform: translate(-50%, -50%) scale(1.05);
  box-shadow: 
    0 0 30px rgba(0, 0, 0, 0.6),
    0 0 60px color-mix(in srgb, var(--rarity-color) 40%, transparent);
}
</style>
