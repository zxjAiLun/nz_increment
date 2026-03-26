<script setup lang="ts">
import type { KeyBinding } from '../composables/useKeyboard'

interface Props {
  visible: boolean
  bindings: KeyBinding[]
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function getKeyDisplay(key: string): string {
  switch (key) {
    case 'Space':
      return '空格'
    case 'Escape':
      return 'Esc'
    default:
      return key.replace('Key', '')
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="keyboard-shortcuts-overlay" @click="close">
    <div class="keyboard-shortcuts-panel" @click.stop>
      <h2>⌨️ 键盘快捷键</h2>
      
      <div class="shortcuts-list">
        <div 
          v-for="binding in bindings" 
          :key="binding.key" 
          class="shortcut-item"
        >
          <div class="shortcut-keys">
            <kbd v-if="binding.key === 'Space'">空格</kbd>
            <kbd v-else-if="binding.key === 'Escape'">Esc</kbd>
            <kbd v-else>{{ getKeyDisplay(binding.key) }}</kbd>
          </div>
          <span class="shortcut-action">{{ binding.action }}</span>
          <span 
            class="shortcut-status" 
            :class="{ disabled: !binding.enabled }"
          >
            {{ binding.enabled ? '✓' : '✗' }}
          </span>
        </div>
      </div>
      
      <div class="shortcuts-tip">提示：快捷键在移动端不生效</div>
      
      <button class="close-shortcuts" @click="close">关闭</button>
    </div>
  </div>
</template>

<style scoped>
.keyboard-shortcuts-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1100;
  backdrop-filter: blur(4px);
}

.keyboard-shortcuts-panel {
  background: var(--color-bg-panel, #1a1a2e);
  border-radius: 16px;
  padding: 2rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.keyboard-shortcuts-panel h2 {
  color: var(--color-primary, #4ecdc4);
  margin-bottom: 1.5rem;
  text-align: center;
  font-size: 1.5rem;
}

.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  transition: all 0.2s;
}

.shortcut-item:hover {
  background: rgba(0, 0, 0, 0.5);
}

.shortcut-keys {
  min-width: 70px;
}

.shortcut-keys kbd {
  display: inline-block;
  background: var(--color-bg-card, #252542);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--color-text-primary, #fff);
}

.shortcut-action {
  flex: 1;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.95rem;
}

.shortcut-status {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 0.85rem;
  font-weight: bold;
}

.shortcut-status:not(.disabled) {
  background: var(--color-primary, #4ecdc4);
  color: #000;
}

.shortcut-status.disabled {
  background: rgba(255, 107, 107, 0.2);
  color: var(--color-accent, #ff6b6b);
}

.shortcuts-tip {
  text-align: center;
  color: var(--color-text-muted, #888);
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.close-shortcuts {
  width: 100%;
  background: var(--color-primary, #4ecdc4);
  color: #000;
  border: none;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.close-shortcuts:hover {
  background: #6ee7df;
  transform: translateY(-1px);
}
</style>
