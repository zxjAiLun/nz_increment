<script setup lang="ts">
import { useEventStore } from '../stores/eventStore'

const event = useEventStore()

const emit = defineEmits<{ close: [] }>()

function accept() {
  event.applyEvent(event.currentEvent!)
  emit('close')
}

function decline() {
  event.clearEvent()
  emit('close')
}
</script>

<template>
  <div class="event-modal" v-if="event.currentEvent">
    <div class="event-card" :class="event.currentEvent.type">
      <div class="event-icon">
        <span v-if="event.currentEvent.type === 'chest'">📦</span>
        <span v-else-if="event.currentEvent.type === 'merchant'">🏪</span>
        <span v-else-if="event.currentEvent.type === 'trap'">⚠️</span>
        <span v-else-if="event.currentEvent.type === 'blessing'">✨</span>
        <span v-else>❓</span>
      </div>
      <h2>{{ event.currentEvent.name }}</h2>
      <p>{{ event.currentEvent.description }}</p>
      <div class="effect">
        <span v-if="event.currentEvent.effect.gold">
          {{ event.currentEvent.effect.gold > 0 ? '+' : '' }}{{ event.currentEvent.effect.gold }} 金币
        </span>
        <span v-if="event.currentEvent.effect.diamond">
          {{ event.currentEvent.effect.diamond > 0 ? '+' : '' }}{{ event.currentEvent.effect.diamond }} 钻石
        </span>
        <span v-if="event.currentEvent.effect.hp">
          {{ event.currentEvent.effect.hp > 0 ? '+' : '' }}{{ event.currentEvent.effect.hp }} HP
        </span>
        <span v-if="event.currentEvent.effect.buff">获得 {{ event.currentEvent.effect.buff }} buff</span>
        <span v-if="event.currentEvent.effect.debuff">获得 {{ event.currentEvent.effect.debuff }} debuff</span>
      </div>
      <div class="actions">
        <button @click="accept()">接受</button>
        <button class="decline" @click="decline()">拒绝</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.event-card {
  background: var(--color-surface);
  border-radius: 16px;
  padding: 32px;
  text-align: center;
  max-width: 320px;
  width: 90%;
}
.event-icon { font-size: 48px; margin-bottom: 16px; }
h2 { margin: 0 0 8px; }
p { color: var(--color-text-secondary); margin: 0 0 16px; }
.effect { font-size: 16px; color: #4ade80; margin-bottom: 20px; }
.effect span { display: block; margin: 4px 0; }
.actions { display: flex; gap: 12px; }
button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
button:not(.decline) { background: var(--color-primary); color: white; }
.decline { background: var(--color-bg-panel); color: var(--color-text-secondary); }
.chest { border: 2px solid #f59e0b; }
.merchant { border: 2px solid #3b82f6; }
.trap { border: 2px solid #ef4444; }
.blessing { border: 2px solid #4ade80; }
.mystery { border: 2px solid #a855f7; }
</style>
