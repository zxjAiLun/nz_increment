<script setup lang="ts">
import { useGuideStore } from '../stores/guideStore'

const guide = useGuideStore()
</script>

<template>
  <Teleport to="body">
    <div v-if="guide.isActive && guide.getCurrentStep()" class="guide-overlay">
      <div class="guide-highlight" :data-step="guide.getCurrentStep()?.id">
        <div class="guide-tooltip" :class="guide.getCurrentStep()?.position">
          <h3>{{ guide.getCurrentStep()?.title }}</h3>
          <p>{{ guide.getCurrentStep()?.description }}</p>
          <div class="guide-progress">
            {{ guide.currentStep + 1 }} / {{ guide.steps.length }}
          </div>
          <div class="guide-buttons">
            <button @click="guide.skipGuide()" class="skip">跳过引导</button>
            <button @click="guide.nextStep()" class="next">下一步</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.guide-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
.guide-highlight {
  position: absolute;
  inset: 0;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}
.guide-tooltip {
  position: absolute;
  background: white;
  color: #333;
  padding: 20px;
  border-radius: 12px;
  max-width: 280px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
.guide-tooltip.top { top: 20px; left: 50%; transform: translateX(-50%); }
.guide-tooltip.bottom { bottom: 20px; left: 50%; transform: translateX(-50%); }
.guide-tooltip.left { left: 20px; top: 50%; transform: translateY(-50%); }
.guide-tooltip.right { right: 20px; top: 50%; transform: translateY(-50%); }
h3 { margin: 0 0 8px; font-size: 16px; }
p { margin: 0 0 12px; font-size: 14px; color: #666; line-height: 1.4; }
.guide-progress { font-size: 12px; color: #999; margin-bottom: 12px; }
.guide-buttons { display: flex; gap: 8px; }
button { flex: 1; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.skip { background: #e5e7eb; color: #666; }
.next { background: var(--color-primary, #3b82f6); color: white; }
</style>
