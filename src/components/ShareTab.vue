<script setup lang="ts">
import { useShareStore } from '../stores/shareStore'

const share = useShareStore()

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    alert('已复制到剪贴板！')
  } catch {
    alert('复制失败，请手动复制')
  }
}
</script>

<template>
  <div class="share-tab">
    <h2>社交分享</h2>

    <div class="quick-share">
      <h3>快速分享</h3>
      <div class="share-buttons">
        <button @click="share.shareBattleVictory(50, 'victory')" class="share-btn victory">
          分享战斗胜利
        </button>
        <button @click="share.shareAchievement('首杀BOSS')" class="share-btn achievement">
          分享成就
        </button>
        <button @click="share.shareRanking(1)" class="share-btn ranking">
          分享排名
        </button>
        <button @click="share.shareEquipment('神器剑', '传说')" class="share-btn equipment">
          分享装备
        </button>
      </div>
    </div>

    <div class="share-history">
      <h3>分享记录</h3>
      <div v-if="share.shareHistory.length === 0" class="empty">暂无分享记录</div>
      <div v-for="s in share.shareHistory" :key="s.id" class="share-card">
        <div class="share-header">
          <span class="share-type" :class="s.type">{{ s.title }}</span>
          <span class="share-time">{{ new Date(s.timestamp).toLocaleString() }}</span>
        </div>
        <div class="share-desc">{{ s.description }}</div>
        <div class="share-code">码: {{ s.shareCode }}</div>
        <button @click="copyToClipboard(share.copyShareText(s))" class="copy-btn">
          复制分享文本
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-tab { padding: 16px; }
.share-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.share-btn {
  padding: 16px;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  color: white;
}
.share-btn.victory { background: linear-gradient(135deg, #4ade80, #22c55e); }
.share-btn.achievement { background: linear-gradient(135deg, #f59e0b, #d97706); }
.share-btn.ranking { background: linear-gradient(135deg, #a855f7, #9333ea); }
.share-btn.equipment { background: linear-gradient(135deg, #4a9eff, #2563eb); }
.share-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  margin-bottom: 12px;
}
.share-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.share-type { font-weight: bold; font-size: 14px; }
.share-type.battle_victory { color: #4ade80; }
.share-type.achievement { color: #f59e0b; }
.share-type.ranking { color: #a855f7; }
.share-type.equipment { color: #4a9eff; }
.share-time { font-size: 12px; color: var(--color-text-secondary); }
.share-desc { font-size: 14px; color: var(--color-text-secondary); margin-bottom: 8px; }
.share-code { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; font-family: monospace; }
.copy-btn {
  width: 100%;
  padding: 10px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.empty { text-align: center; padding: 40px; color: var(--color-text-secondary); }
h3 { margin-bottom: 8px; }
</style>
