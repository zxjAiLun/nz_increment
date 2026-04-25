<script setup lang="ts">
import { computed } from 'vue'
import { useBossRushStore } from '../stores/bossRushStore'
import { BOSS_RUSH_BOSSES } from '../data/bossRush'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { getDominantBuildArchetype } from '../data/buildArchetypes'
import { estimateCombatKpis, getChallengeDecisionHint } from '../utils/combatInsights'

const rush = useBossRushStore()
const playerStore = usePlayerStore()
const monsterStore = useMonsterStore()

const challengeHint = computed(() => getChallengeDecisionHint(
  estimateCombatKpis(playerStore.player, playerStore.totalStats, monsterStore.currentMonster, monsterStore.difficultyValue),
  getDominantBuildArchetype(playerStore.totalStats).archetype.shortName
))

function start() {
  rush.startBossRush()
}

function getBossClass(difficulty: number) {
  if (difficulty >= 5) return 'legend'
  if (difficulty >= 3) return 'epic'
  if (difficulty >= 2) return 'rare'
  return 'common'
}
</script>

<template>
  <div class="boss-rush-tab">
    <h2>Boss Rush</h2>
    <p v-if="!rush.isActive">挑战5个Boss，按击杀时间排名</p>

    <div class="challenge-decision" :class="challengeHint.severity">
      <div><span>失败原因</span><strong>{{ challengeHint.failureReason }}</strong></div>
      <div><span>推荐构筑</span><strong>{{ challengeHint.recommendedBuild }}</strong></div>
      <div><span>推荐属性</span><strong>{{ challengeHint.recommendedStats.join(' / ') }}</strong></div>
      <div><span>预计修正</span><strong>{{ challengeHint.expectedFix }}</strong></div>
    </div>

    <div v-if="!rush.isActive" class="start-section">
      <div class="boss-preview">
        <div v-for="(boss, i) in BOSS_RUSH_BOSSES" :key="boss.bossId" class="boss-item">
          <span class="rank">{{ i + 1 }}</span>
          <span :class="getBossClass(boss.difficulty)">{{ boss.name }}</span>
          <span class="diff">x{{ boss.difficulty }}</span>
        </div>
      </div>
      <button @click="start" class="start-btn">开始挑战</button>
    </div>

    <div v-else class="rush-active">
      <div class="progress">
        Boss {{ rush.currentBossIndex + 1 }} / {{ BOSS_RUSH_BOSSES.length }}
      </div>
      <div v-if="rush.getCurrentBoss()" class="current-boss">
        <h3>{{ rush.getCurrentBoss()!.name }}</h3>
        <p>HP: {{ rush.getCurrentBoss()!.maxHp.toLocaleString() }}</p>
      </div>
      <button @click="rush.endBossRush()" class="quit-btn">退出</button>
    </div>

    <div v-if="rush.scores.length > 0" class="score-board">
      <h3>历史成绩</h3>
      <div v-for="(score, i) in rush.scores" :key="i" class="score-row">
        <span>{{ BOSS_RUSH_BOSSES.find(b => b.bossId === score.bossId)?.name }}</span>
        <span>{{ score.score }}分</span>
      </div>
      <div class="total-score">总分: {{ rush.totalScore }}</div>
    </div>
  </div>
</template>

<style scoped>
.challenge-decision { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; margin: 12px 0; border-radius: 10px; background: var(--color-bg-panel); border: 1px solid var(--color-border); }
.challenge-decision.warning { border-color: #f59e0b; }
.challenge-decision.danger { border-color: #ef4444; }
.challenge-decision div { display: flex; flex-direction: column; gap: 3px; }
.challenge-decision span { font-size: 11px; color: var(--color-text-muted); }
.challenge-decision strong { font-size: 12px; color: var(--color-text-primary); line-height: 1.4; }
.boss-preview { margin: 20px 0; }
.boss-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  background: var(--color-bg-panel);
  border-radius: 8px;
  margin-bottom: 6px;
}
.rank { font-weight: bold; min-width: 24px; }
.common { color: #888; }
.rare { color: #4a9eff; }
.epic { color: #a855f7; }
.legend { color: #f59e0b; }
.diff { margin-left: auto; color: #f59e0b; }
.start-btn {
  width: 100%;
  padding: 16px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 18px;
  font-weight: bold;
}
.quit-btn {
  padding: 10px 24px;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-top: 16px;
}
.total-score {
  font-size: 20px;
  font-weight: bold;
  text-align: center;
  margin-top: 12px;
  color: #f59e0b;
}
</style>
