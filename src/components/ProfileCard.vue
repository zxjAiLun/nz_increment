<script setup lang="ts">
import { computed } from 'vue'
import { useProfileStore } from '../stores/profileStore'

const profile = useProfileStore()

const previewAchievements = computed(() => profile.profile.achievements.slice(0, 5))
</script>

<template>
  <div class="profile-card">
    <div class="profile-header">
      <div class="avatar" :class="profile.profile.avatarFrame">
        {{ profile.profile.playerName.charAt(0) }}
      </div>
      <div class="player-info">
        <h2>{{ profile.profile.playerName }}</h2>
        <p>Lv.{{ profile.profile.level }} · {{ profile.profile.equippedTitle }}</p>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-item">
        <span class="value">{{ profile.profile.stats.totalBattles }}</span>
        <span class="label">总战斗</span>
      </div>
      <div class="stat-item win">
        <span class="value">{{ profile.profile.stats.victories }}</span>
        <span class="label">胜利</span>
      </div>
      <div class="stat-item lose">
        <span class="value">{{ profile.profile.stats.defeat }}</span>
        <span class="label">失败</span>
      </div>
      <div class="stat-item rate">
        <span class="value">{{ profile.profile.stats.winRate }}%</span>
        <span class="label">胜率</span>
      </div>
    </div>

    <div class="more-stats">
      <div class="more-row">
        <span>累计伤害</span>
        <span>{{ profile.profile.stats.totalDamage.toLocaleString() }}</span>
      </div>
      <div class="more-row">
        <span>累计金币</span>
        <span>{{ profile.profile.stats.totalGoldEarned.toLocaleString() }}</span>
      </div>
      <div class="more-row">
        <span>Boss击杀</span>
        <span>{{ profile.profile.stats.bossKills }}</span>
      </div>
      <div class="more-row">
        <span>游玩天数</span>
        <span>{{ profile.profile.stats.daysPlayed }}</span>
      </div>
      <div class="more-row">
        <span>注册日期</span>
        <span>{{ new Date(profile.profile.joinDate).toLocaleDateString() }}</span>
      </div>
    </div>

    <div class="achievements-preview">
      <h3>成就 ({{ profile.profile.achievements.length }})</h3>
      <div class="ach-list">
        <span v-for="ach in previewAchievements" :key="ach" class="ach-tag">
          {{ ach }}
        </span>
        <span v-if="profile.profile.achievements.length > 5">+{{ profile.profile.achievements.length - 5 }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-card {
  padding: 16px;
  max-width: 400px;
  margin: 0 auto;
}
.profile-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: bold;
}
.player-info h2 { margin: 0; }
.player-info p { margin: 4px 0 0; font-size: 14px; color: var(--color-text-secondary); }
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.stat-item {
  padding: 12px 8px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  text-align: center;
}
.stat-item .value { display: block; font-size: 20px; font-weight: bold; }
.stat-item .label { font-size: 11px; color: var(--color-text-secondary); }
.stat-item.win .value { color: #4ade80; }
.stat-item.lose .value { color: #ef4444; }
.stat-item.rate .value { color: #f59e0b; }
.more-stats { margin-bottom: 16px; }
.more-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}
.achievements-preview h3 { margin: 0 0 8px; font-size: 14px; }
.ach-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ach-tag {
  padding: 4px 8px;
  background: var(--color-bg-panel);
  border-radius: 4px;
  font-size: 12px;
}
</style>
