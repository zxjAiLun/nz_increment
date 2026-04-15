<script setup lang="ts">
import { WORLD_BOSSES } from '../data/worldBoss'
import { useWorldBossStore } from '../stores/worldBossStore'

const wb = useWorldBossStore()
</script>

<template>
  <div class="world-boss-tab">
    <h2>世界Boss</h2>
    <div class="tickets">挑战券: {{ wb.challengeTickets }}</div>

    <div v-if="!wb.currentBoss" class="boss-select">
      <h3>选择Boss</h3>
      <div v-for="boss in WORLD_BOSSES" :key="boss.id" class="boss-card">
        <div class="boss-name">{{ boss.name }}</div>
        <div class="boss-hp">HP: {{ boss.maxHp.toLocaleString() }}</div>
        <div class="boss-rewards">奖励: {{ boss.rewards.diamond }}钻石</div>
        <button @click="wb.spawnBoss(boss.id)">挑战</button>
      </div>
    </div>

    <div v-else class="boss-battle">
      <div class="boss-header">
        <h3>{{ wb.currentBoss.name }}</h3>
        <button @click="wb.spawnBoss(wb.currentBoss!.id)" :disabled="wb.challengeTickets <= 0">
          使用挑战券再战
        </button>
      </div>

      <div class="hp-bar">
        <div class="hp-fill" :style="{ width: wb.getBossHpPercent() + '%' }"></div>
        <span class="hp-text">{{ wb.getBossHpPercent() }}%</span>
      </div>

      <div class="stats">
        <div>总伤害: {{ wb.totalDamage.toLocaleString() }}</div>
        <div>我的贡献: {{ wb.myContribution.toLocaleString() }}</div>
        <div>我的排名: #{{ wb.getMyRank() }}</div>
      </div>

      <div v-if="wb.isDefeated" class="victory-banner">
        Boss已击败! 奖励已发放
      </div>

      <div class="attack-section">
        <button @click="wb.attackBoss(10000)" :disabled="!wb.useTicket() || wb.isDefeated">
          攻击 (消耗1券, 造成10000伤害)
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.world-boss-tab { padding: 16px; }
.tickets { text-align: right; font-weight: bold; color: var(--color-primary); margin-bottom: 16px; }
.boss-card {
  padding: 16px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  margin-bottom: 12px;
}
.boss-name { font-weight: bold; font-size: 18px; color: #ef4444; }
.boss-hp, .boss-rewards { font-size: 14px; color: var(--color-text-secondary); margin: 4px 0; }
.boss-card button { margin-top: 8px; padding: 8px 24px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; }
.hp-bar { height: 24px; background: #333; border-radius: 12px; overflow: hidden; margin: 16px 0; position: relative; }
.hp-fill { height: 100%; background: linear-gradient(90deg, #ef4444, #f97316); transition: width 0.3s; }
.hp-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: bold; }
.stats { display: flex; gap: 16px; margin: 16px 0; font-size: 14px; }
.victory-banner { text-align: center; padding: 20px; background: linear-gradient(135deg, #f59e0b, #ef4444); color: white; border-radius: 12px; font-size: 18px; font-weight: bold; margin: 16px 0; }
.attack-section button { width: 100%; padding: 16px; background: #ef4444; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
.attack-section button:disabled { background: #666; cursor: not-allowed; }
.boss-header { display: flex; justify-content: space-between; align-items: center; }
.boss-header button { padding: 8px 16px; background: #f97316; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.boss-header button:disabled { background: #666; cursor: not-allowed; }
</style>
