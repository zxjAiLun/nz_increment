<script setup lang="ts">
import { computed, ref } from 'vue'
import { WORLD_BOSSES } from '../data/worldBoss'
import { useWorldBossStore } from '../stores/worldBossStore'

const wb = useWorldBossStore()

const BEST_CONTRIBUTION_KEY = 'nz_world_event_best_contribution_v1'
const bestContribution = ref<number>(Number(localStorage.getItem(BEST_CONTRIBUTION_KEY) || '0'))

const shadowRankings = computed(() => {
  const myDamage = wb.myContribution
  const shadows = [
    { name: '影子冒险者A', damage: Math.max(0, Math.floor(myDamage * 1.22) + 5000) },
    { name: '影子冒险者B', damage: Math.max(0, Math.floor(myDamage * 1.05) + 2500) },
    { name: '影子冒险者C', damage: Math.max(0, Math.floor(myDamage * 0.88) + 1800) },
    { name: '影子冒险者D', damage: Math.max(0, Math.floor(myDamage * 0.72) + 800) }
  ]
  const rows = [{ name: '我', damage: myDamage }, ...shadows]
  return rows.sort((a, b) => b.damage - a.damage).map((row, index) => ({ ...row, rank: index + 1 }))
})

const myShadowRank = computed(() => shadowRankings.value.find(row => row.name === '我')?.rank || 1)

function startEvent(bossId: string) {
  wb.spawnBoss(bossId)
}

function restartCurrentEvent() {
  if (!wb.currentBoss || wb.challengeTickets <= 0) return
  wb.spawnBoss(wb.currentBoss.id)
}

function attackOnce() {
  if (wb.isDefeated) return
  if (!wb.useTicket()) return
  wb.attackBoss(10000)
  if (wb.myContribution > bestContribution.value) {
    bestContribution.value = wb.myContribution
    localStorage.setItem(BEST_CONTRIBUTION_KEY, String(bestContribution.value))
  }
}
</script>

<template>
  <div class="world-boss-tab">
    <h2>世界事件</h2>
    <p class="mode-desc">单机镜像挑战：本地影子榜 + 历史最佳贡献</p>
    <div class="tickets">挑战券: {{ wb.challengeTickets }}</div>

    <div v-if="!wb.currentBoss" class="boss-select">
      <h3>选择事件首领</h3>
      <div v-for="boss in WORLD_BOSSES" :key="boss.id" class="boss-card">
        <div class="boss-name">{{ boss.name }}</div>
        <div class="boss-hp">HP: {{ boss.maxHp.toLocaleString() }}</div>
        <div class="boss-rewards">奖励: {{ boss.rewards.diamond }}钻石</div>
        <button @click="startEvent(boss.id)">进入事件</button>
      </div>
    </div>

    <div v-else class="boss-battle">
      <div class="boss-header">
        <h3>{{ wb.currentBoss.name }}</h3>
        <button @click="restartCurrentEvent" :disabled="wb.challengeTickets <= 0">
          重新挑战
        </button>
      </div>

      <div class="hp-bar">
        <div class="hp-fill" :style="{ width: wb.getBossHpPercent() + '%' }"></div>
        <span class="hp-text">{{ wb.getBossHpPercent() }}%</span>
      </div>

      <div class="stats">
        <div>事件总伤害: {{ wb.totalDamage.toLocaleString() }}</div>
        <div>我的贡献: {{ wb.myContribution.toLocaleString() }}</div>
        <div>影子排名: #{{ myShadowRank }}</div>
        <div>历史最佳贡献: {{ bestContribution.toLocaleString() }}</div>
      </div>

      <div v-if="wb.isDefeated" class="victory-banner">
        世界事件已完成，奖励已发放
      </div>

      <div class="attack-section">
        <button @click="attackOnce" :disabled="wb.challengeTickets <= 0 || wb.isDefeated">
          攻击 (消耗1券, 造成10000伤害)
        </button>
      </div>

      <div class="shadow-board">
        <h4>本地影子榜</h4>
        <div v-for="row in shadowRankings" :key="row.name" class="shadow-row" :class="{ mine: row.name === '我' }">
          <span>#{{ row.rank }}</span>
          <span>{{ row.name }}</span>
          <span>{{ row.damage.toLocaleString() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.world-boss-tab { padding: 16px; }
.mode-desc { color: var(--color-text-secondary); font-size: 13px; margin: 6px 0 12px; }
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
.shadow-board { margin-top: 16px; padding: 12px; border-radius: 10px; background: var(--color-bg-panel); }
.shadow-row { display: grid; grid-template-columns: 50px 1fr auto; gap: 8px; padding: 6px 4px; color: var(--color-text-secondary); font-size: 13px; }
.shadow-row.mine { color: var(--color-primary); font-weight: 700; }
</style>
