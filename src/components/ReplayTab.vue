<script setup lang="ts">
import { useReplayStore } from '../stores/replayStore'

const replay = useReplayStore()
</script>

<template>
  <div class="replay-tab">
    <h2>战斗回顾</h2>

    <div v-if="!replay.currentReplay" class="replay-list">
      <div v-if="replay.replays.length === 0" class="empty">暂无战斗记录</div>
      <div v-for="r in replay.replays" :key="r.id" class="replay-item" @click="replay.loadReplay(r.id)">
        <div class="replay-header">
          <span class="result" :class="r.result">{{ r.result === 'victory' ? '胜利' : '失败' }}</span>
          <span class="floor">第{{ r.floor }}层</span>
          <span class="time">{{ new Date(r.startTime).toLocaleString() }}</span>
        </div>
        <div class="replay-summary">
          回合数: {{ r.events.length }} | 角色HP: {{ r.finalPlayerHp }} | 敌人HP: {{ r.finalEnemyHp }}
        </div>
      </div>
    </div>

    <div v-else class="replay-viewer">
      <div class="viewer-header">
        <button @click="replay.currentReplay = null">返回列表</button>
        <h3>回放中</h3>
        <button @click="replay.startPlayback()" :disabled="replay.isPlaying">播放</button>
        <button @click="replay.pausePlayback()" :disabled="!replay.isPlaying">暂停</button>
      </div>

      <div class="event-display">
        <div v-if="replay.getCurrentEvent()" class="current-event">
          <span class="turn">回合 {{ replay.playbackIndex + 1 }}</span>
          <span class="desc">{{ replay.getCurrentEvent()?.description }}</span>
          <span v-if="replay.getCurrentEvent()?.damage" class="damage">-{{ replay.getCurrentEvent()?.damage }}</span>
        </div>
        <div v-else class="replay-end">回放结束</div>
      </div>

      <div class="progress-bar">
        <div class="fill" :style="{ width: (replay.playbackIndex / (replay.currentReplay?.events.length || 1) * 100) + '%' }"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-tab { padding: 16px; }
.replay-item {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  margin-bottom: 12px;
  cursor: pointer;
}
.replay-item:hover { opacity: 0.8; }
.replay-header { display: flex; gap: 12px; margin-bottom: 8px; }
.result.victory { color: #4ade80; font-weight: bold; }
.result.defeat { color: #ef4444; font-weight: bold; }
.floor { font-weight: bold; }
.time { font-size: 12px; color: var(--color-text-secondary); margin-left: auto; }
.replay-summary { font-size: 12px; color: var(--color-text-secondary); }
.viewer-header { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
.viewer-header h3 { flex: 1; margin: 0; }
.viewer-header button { padding: 6px 12px; background: var(--color-bg-panel); border: none; border-radius: 6px; cursor: pointer; }
.current-event {
  padding: 20px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  text-align: center;
  margin-bottom: 16px;
}
.turn { font-size: 12px; color: var(--color-text-secondary); }
.desc { font-size: 16px; display: block; margin: 8px 0; }
.damage { font-size: 24px; color: #ef4444; font-weight: bold; }
.replay-end { text-align: center; padding: 40px; color: var(--color-text-secondary); }
.progress-bar { height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden; }
.fill { height: 100%; background: var(--color-primary); transition: width 0.2s; }
.empty { text-align: center; padding: 40px; color: var(--color-text-secondary); }
</style>
