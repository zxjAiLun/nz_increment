<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAdventureStore } from '../stores/adventureStore'

const adventureStore = useAdventureStore()
onMounted(() => adventureStore.load())

const currentNode = computed(() => adventureStore.currentNode)

function startNewRun() {
  adventureStore.startRun('player', 1000)
}

function selectOption(index: number) {
  adventureStore.selectOption(index)
}

function abandonRun() {
  adventureStore.abandonRun()
}

function getNodeIcon(type: string): string {
  const icons: Record<string, string> = {
    combat: '⚔️', elite: '💀', boss: '👹',
    treasure: '📦', mystery: '❓', rest: '🏕️',
    shop: '🏪', event: '🎲'
  }
  return icons[type] || '❓'
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}秒`
  const mins = Math.floor(secs / 60)
  return `${mins}分${secs % 60}秒`
}
</script>

<template>
  <div class="adventure-tab">
    <div class="adventure-header">
      <h2>冒险模式</h2>
      <div class="adventure-stats">
        <span>完成: {{ adventureStore.completedRuns.length }}次</span>
        <span>最佳章节: {{ adventureStore.bestChapter }}</span>
      </div>
    </div>

    <!-- 无活跃冒险 -->
    <div v-if="!adventureStore.currentRun || adventureStore.currentRun.status !== 'active'" class="no-run">
      <div class="run-info">
        <p>roguelike 冒险模式</p>
        <p>每次冒险由7个节点组成，击败3章节即可通关</p>
        <p>收集金币、增益buff，挑战BOSS！</p>
      </div>
      <button class="start-btn" @click="startNewRun">开始新冒险</button>
      <div v-if="adventureStore.currentRun?.status === 'failed'" class="run-result failed">
        <p>冒险失败！下次一定</p>
        <button class="retry-btn" @click="startNewRun">再试一次</button>
      </div>
      <div v-if="adventureStore.currentRun?.status === 'completed'" class="run-result success">
        <p>冒险完成！太棒了！</p>
        <button class="retry-btn" @click="startNewRun">再来一次</button>
      </div>
    </div>

    <!-- 活跃冒险 -->
    <div v-else class="active-run">
      <div class="run-status">
        <div class="hp-bar">
          <div class="hp-fill" :style="{ width: (adventureStore.currentRun.playerHp / adventureStore.currentRun.playerMaxHp * 100) + '%' }"></div>
        </div>
        <div class="hp-text">
          HP: {{ adventureStore.currentRun.playerHp }} / {{ adventureStore.currentRun.playerMaxHp }}
        </div>
        <div class="gold-display">💰 {{ adventureStore.currentRun.gold }}</div>
        <div class="chapter-display">章节: {{ adventureStore.currentRun.chaptersCompleted + 1 }}</div>
        <div class="buff-list" v-if="adventureStore.currentRun.buffs.length">
          <span v-for="buff in adventureStore.currentRun.buffs" :key="buff" class="buff-tag">{{ buff }}</span>
        </div>
      </div>

      <!-- 当前节点 -->
      <div v-if="currentNode" class="current-node">
        <div class="node-header">
          <span class="node-icon">{{ getNodeIcon(currentNode.type) }}</span>
          <span class="node-name">{{ currentNode.name }}</span>
        </div>
        <p class="node-desc">{{ currentNode.description }}</p>

        <div class="node-options">
          <button
            v-for="(option, idx) in currentNode.options"
            :key="idx"
            class="option-btn"
            @click="selectOption(idx)"
          >
            {{ option.text }}
          </button>
        </div>
      </div>

      <button class="abandon-btn" @click="abandonRun">放弃冒险</button>
    </div>
  </div>
</template>

<style scoped>
.adventure-tab { padding: 12px; overflow-y: auto; height: 100%; }
.adventure-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.adventure-header h2 { margin: 0; font-size: 18px; }
.adventure-stats { display: flex; gap: 12px; font-size: 13px; color: #888; }
.no-run { text-align: center; padding: 40px 20px; }
.run-info { background: #1a1a2e; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
.run-info p { margin: 8px 0; color: #888; font-size: 14px; }
.start-btn, .retry-btn { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; cursor: pointer; }
.run-result { margin-top: 16px; }
.run-result.failed p { color: #f87171; }
.run-result.success p { color: #4ade80; }
.active-run { display: flex; flex-direction: column; gap: 16px; }
.run-status { background: #1a1a2e; padding: 16px; border-radius: 12px; }
.hp-bar { height: 12px; background: #333; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
.hp-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #22c55e); transition: width 0.3s; }
.hp-text { font-size: 13px; color: #888; }
.gold-display, .chapter-display { font-size: 14px; margin-top: 4px; }
.buff-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.buff-tag { background: #4f46e5; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.current-node { background: #1a1a2e; padding: 20px; border-radius: 12px; }
.node-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.node-icon { font-size: 24px; }
.node-name { font-size: 18px; font-weight: 600; }
.node-desc { color: #888; margin-bottom: 16px; }
.node-options { display: flex; flex-direction: column; gap: 8px; }
.option-btn { background: #2a2a4a; border: 1px solid #4a4a6a; padding: 10px 16px; border-radius: 8px; color: white; cursor: pointer; text-align: left; transition: background 0.2s; }
.option-btn:hover { background: #3a3a5a; }
.abandon-btn { background: transparent; border: 1px solid #dc2626; color: #dc2626; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
</style>
