<script setup lang="ts">
import { computed, onMounted } from 'vue'

const props = defineProps<{
  type: 'damage' | 'heal' | 'buff'
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'complete'): void
}>()

const effectStyle = computed(() => {
  return {
    left: props.x + 'px',
    top: props.y + 'px'
  }
})

const effectClass = computed(() => {
  return `effect-${props.type}`
})

onMounted(() => {
  setTimeout(() => {
    emit('complete')
  }, 400)
})
</script>

<template>
  <div
    class="skill-effect"
    :class="effectClass"
    :style="effectStyle"
  >
    <div class="effect-ring"></div>
    <div class="effect-ring effect-ring-2"></div>
    <div class="effect-core"></div>
  </div>
</template>

<style scoped>
.skill-effect {
  position: absolute;
  width: 50px;
  height: 50px;
  pointer-events: none;
  z-index: 1000;
  transform: translate(-50%, -50%);
}

.effect-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  animation: ring-expand 400ms ease-out forwards;
}

.effect-ring-2 {
  animation-delay: 50ms;
}

.effect-core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: core-pulse 400ms ease-out forwards;
}

.effect-damage .effect-ring {
  border: 3px solid var(--color-primary);
  box-shadow: 0 0 15px var(--color-primary), inset 0 0 15px var(--color-primary);
}

.effect-damage .effect-core {
  background: radial-gradient(circle, var(--color-primary-light) 0%, var(--color-primary) 70%, transparent 100%);
  box-shadow: 0 0 20px var(--color-primary);
}

.effect-heal .effect-ring {
  border: 3px solid var(--color-success);
  box-shadow: 0 0 15px var(--color-success), inset 0 0 15px var(--color-success);
}

.effect-heal .effect-core {
  background: radial-gradient(circle, #8fff8f 0%, var(--color-success) 70%, transparent 100%);
  box-shadow: 0 0 20px var(--color-success);
}

.effect-buff .effect-ring {
  border: 3px solid var(--color-gold);
  box-shadow: 0 0 15px var(--color-gold), inset 0 0 15px var(--color-gold);
}

.effect-buff .effect-core {
  background: radial-gradient(circle, var(--color-gold-light) 0%, var(--color-gold) 70%, transparent 100%);
  box-shadow: 0 0 20px var(--color-gold);
}

@keyframes ring-expand {
  0% {
    transform: scale(0.3);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

@keyframes core-pulse {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.5);
    opacity: 0.8;
  }
  100% {
    transform: translate(-50%, -50%) scale(0.5);
    opacity: 0;
  }
}
</style>
