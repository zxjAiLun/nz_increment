<template>
  <div class="talent-tab">
    <section class="talent-overview ui-panel">
      <div>
        <p class="section-kicker">Talent Tree</p>
        <h2>长期成长路线</h2>
      </div>
      <div class="talent-meters">
        <div class="talent-meter">
          <span>可用点数</span>
          <strong>{{ talent.talentPoints }}</strong>
        </div>
        <div class="talent-meter">
          <span>已投入</span>
          <strong>{{ talent.spentPoints }}</strong>
        </div>
      </div>
      <button class="ui-btn" :disabled="talent.spentPoints <= 0" @click="talent.resetTalents()">
        重置天赋
      </button>
    </section>

    <section class="talent-branches">
      <article
        v-for="branch in branchSummaries"
        :key="branch.id"
        class="talent-branch ui-panel"
      >
        <header class="branch-header">
          <div>
            <p class="section-kicker">{{ branch.name }}</p>
            <h3>{{ branch.summary }}</h3>
          </div>
          <div class="branch-progress">
            <span>{{ branch.levels }} 级</span>
            <strong>{{ branch.spent }} 点</strong>
          </div>
        </header>

        <div class="talent-node-grid">
          <article
            v-for="node in talent.getNodesByBranch(branch.id)"
            :key="node.id"
            class="talent-node"
            :class="nodeClass(node)"
          >
            <div class="node-head">
              <div>
                <span class="node-tier">T{{ node.tier }}</span>
                <h4>{{ node.name }}</h4>
              </div>
              <span class="node-level">{{ talent.getLevel(node.id) }}/{{ node.maxLevel }}</span>
            </div>
            <p class="node-description">{{ node.description }}</p>
            <div class="node-effects">
              <span v-for="effect in effectTexts(node)" :key="effect" class="ui-chip">{{ effect }}</span>
            </div>
            <p v-if="missingPrerequisites(node).length" class="node-lock">
              需要：{{ missingPrerequisites(node).join(' / ') }}
            </p>
            <button
              class="ui-btn-primary node-action"
              :disabled="!talent.canUnlock(node.id)"
              @click="talent.upgradeTalent(node.id)"
            >
              {{ actionLabel(node) }}
            </button>
          </article>
        </div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TALENT_BRANCHES, type TalentEffect, type TalentNode } from '../data/talents'
import { STAT_NAMES } from '../types'
import { useTalentStore } from '../stores/talentStore'

const talent = useTalentStore()

const branchSummaries = computed(() => TALENT_BRANCHES.map(branch => {
  const summary = talent.branchSummaries.find(entry => entry.id === branch.id)
  return summary ?? { ...branch, spent: 0, levels: 0 }
}))

function nodeClass(node: TalentNode): Record<string, boolean> {
  return {
    'is-learned': talent.getLevel(node.id) > 0,
    'is-maxed': talent.isMaxed(node.id),
    'is-locked': !talent.canUnlock(node.id) && !talent.isMaxed(node.id)
  }
}

function formatEffect(effect: TalentEffect): string {
  const sign = effect.value > 0 ? '+' : ''
  if (effect.stat) {
    const statName = STAT_NAMES[effect.stat] ?? effect.stat
    const suffix = effect.type === 'percent' || effect.stat.includes('Percent') || effect.stat.includes('Chance') || effect.stat.includes('Reduction')
      ? '%'
      : ''
    return `${statName} ${sign}${effect.value}${suffix}/级`
  }
  const specialNames: Record<string, string> = {
    deathSetbackReduction: '死亡后退',
    safeModeBonusSeconds: '保护时间',
    fatigueReductionPercent: '疲劳减免',
    goldBonusPercent: '金币收益',
    equipmentDropBonusPercent: '装备掉率',
    rarityBonus: '稀有度加成'
  }
  const suffix = effect.special?.includes('Percent') ? '%' : effect.special?.includes('Seconds') ? '秒' : ''
  return `${specialNames[effect.special ?? ''] ?? effect.special} ${sign}${effect.value}${suffix}/级`
}

function effectTexts(node: TalentNode): string[] {
  return node.effects.map(formatEffect)
}

function missingPrerequisites(node: TalentNode): string[] {
  return (node.prerequisites ?? [])
    .filter(id => talent.getLevel(id) <= 0)
    .map(id => talent.getNode(id)?.name ?? id)
}

function actionLabel(node: TalentNode): string {
  if (talent.isMaxed(node.id)) return '已点满'
  if (talent.talentPoints < node.costPerLevel) return `需要 ${node.costPerLevel} 点`
  if (missingPrerequisites(node).length > 0) return '未解锁'
  return `投入 ${node.costPerLevel} 点`
}
</script>

<style scoped>
.talent-tab {
  display: grid;
  gap: var(--spacing-lg);
}

.talent-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--spacing-lg);
  align-items: center;
}

.section-kicker {
  margin: 0 0 var(--spacing-xs);
  color: var(--color-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.talent-overview h2,
.branch-header h3,
.talent-node h4 {
  margin: 0;
}

.talent-overview h2 {
  font-size: 1.15rem;
}

.talent-meters {
  display: flex;
  gap: var(--spacing-sm);
}

.talent-meter {
  min-width: 92px;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-glass);
}

.talent-meter span,
.branch-progress span {
  display: block;
  color: var(--color-text-muted);
  font-size: 0.76rem;
}

.talent-meter strong,
.branch-progress strong {
  color: var(--color-text-primary);
  font-size: 1.1rem;
}

.talent-branches {
  display: grid;
  gap: var(--spacing-lg);
}

.talent-branch {
  display: grid;
  gap: var(--spacing-md);
}

.branch-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-md);
  align-items: start;
}

.branch-header h3 {
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.5;
}

.branch-progress {
  min-width: 82px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  text-align: right;
}

.talent-node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--spacing-md);
}

.talent-node {
  display: grid;
  min-height: 226px;
  gap: var(--spacing-sm);
  align-content: start;
  padding: var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: var(--gradient-card);
  transition: border-color 160ms ease, transform 160ms ease;
}

.talent-node.is-learned {
  border-color: color-mix(in srgb, var(--color-secondary) 50%, var(--color-border));
}

.talent-node.is-maxed {
  border-color: color-mix(in srgb, var(--color-gold) 58%, var(--color-border));
}

.talent-node.is-locked {
  opacity: 0.72;
}

.node-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-sm);
}

.node-tier,
.node-level {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.talent-node h4 {
  font-size: 1rem;
}

.node-description,
.node-lock {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.node-effects {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.node-lock {
  color: var(--color-primary);
}

.node-action {
  align-self: end;
  width: 100%;
  margin-top: auto;
}

@media (max-width: 760px) {
  .talent-overview,
  .branch-header {
    grid-template-columns: 1fr;
  }

  .talent-meters {
    width: 100%;
  }

  .talent-meter {
    flex: 1;
  }

  .branch-progress {
    text-align: left;
  }
}
</style>
