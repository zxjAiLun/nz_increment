<script setup lang="ts">
// Phase 3.24：RuneInventoryTab 拆分为接线层 —— 全部视图派生、面板状态、watch、
// 预览与事务协调迁入 useRuneInventoryController()；本文件仅保留 composable 接线、
// 原模板与外部 scoped 样式引用。DOM 层级 / class / aria-label / 按钮文字 / 默认状态 /
// 面板互斥 / canonical-ID 身份规则 / 事务行为均与拆分前一致。
import { useRuneInventoryController } from '../composables/useRuneInventoryController'

const {
  // 状态
  filter,
  sortKey,
  feedback,
  showPicker,
  feedMaterialRuneIds,
  showFeedPanel,
  showBatchLockPanel,
  batchLockRuneIds,
  batchLockDesiredState,
  // 视图派生
  isBroken,
  rows,
  sorted,
  summary,
  isDefaultFilterSort,
  equippedTargets,
  pickerRune,
  feedTarget,
  feedCandidates,
  feedSelectionSummary,
  feedPreviewModel,
  batchLockCandidates,
  batchLockPreview,
  batchLockChangedNames,
  // 事件 / 动作
  resetFilterSort,
  openPicker,
  closePicker,
  confirmEmbed,
  confirmRemove,
  toggleLock,
  openFeedPanel,
  closeFeedPanel,
  toggleFeedMaterial,
  confirmFeed,
  openBatchLockPanel,
  closeBatchLockPanel,
  toggleBatchLockRune,
  confirmBatchLock,
  // 展示辅助
  statNames,
  slotNames,
  feedExp
} = useRuneInventoryController()
</script>

<template>
  <section class="rune-inventory" aria-label="符文仓库">
    <!-- 损坏状态：只显示异常横幅，不显示摘要/筛选/卡片/picker/操作按钮 -->
    <div v-if="isBroken" class="broken-banner" role="alert">
      符文数据或装备拓扑异常，当前无法管理
    </div>

    <template v-else>
      <!-- 摘要 -->
      <div class="summary" role="group" aria-label="符文仓库摘要">
        <span>总数 {{ summary.total }}</span>
        <span>已镶嵌 {{ summary.embedded }}</span>
        <span>未镶嵌 {{ summary.unequipped }}</span>
        <span>已锁定 {{ summary.locked }}</span>
        <span>未锁定 {{ summary.unlocked }}</span>
        <span>普通 {{ summary.byRarity.common }}</span>
        <span>稀有 {{ summary.byRarity.rare }}</span>
        <span>史诗 {{ summary.byRarity.epic }}</span>
        <span>传说 {{ summary.byRarity.legend }}</span>
      </div>

      <!-- 筛选 + 排序 -->
      <div class="controls">
        <label>
          类型
          <select aria-label="按类型筛选" v-model="filter.type">
            <option value="all">全部</option>
            <option value="attack">攻击</option>
            <option value="defense">防御</option>
            <option value="health">生命</option>
            <option value="crit">暴击</option>
            <option value="speed">速度</option>
            <option value="luck">幸运</option>
          </select>
        </label>
        <label>
          稀有度
          <select aria-label="按稀有度筛选" v-model="filter.rarity">
            <option value="all">全部</option>
            <option value="common">普通</option>
            <option value="rare">稀有</option>
            <option value="epic">史诗</option>
            <option value="legend">传说</option>
          </select>
        </label>
        <label>
          状态
          <select aria-label="按状态筛选" v-model="filter.status">
            <option value="all">全部</option>
            <option value="embedded">已镶嵌</option>
            <option value="unequipped">未镶嵌</option>
          </select>
        </label>
        <label>
          锁定状态
          <select aria-label="按锁定状态筛选" v-model="filter.lock">
            <option value="all">全部</option>
            <option value="locked">已锁定</option>
            <option value="unlocked">未锁定</option>
          </select>
        </label>
        <label>
          排序
          <select aria-label="排序方式" v-model="sortKey">
            <option value="inventory">仓库顺序</option>
            <option value="rarity">稀有度</option>
            <option value="level">等级</option>
            <option value="effective">有效属性</option>
            <option value="locked-first">已锁定优先</option>
            <option value="unlocked-first">未锁定优先</option>
          </select>
        </label>

        <!-- Phase 3.23：筛选/排序匹配计数（X=当前筛选排序结果数，Y=合法仓库总数）与重置按钮。
             数据损坏时不渲染（整个 v-else 分支不可见）；仅组件本地状态，不持久化。 -->
        <div class="filter-meta">
          <span class="match-count" role="status" aria-label="筛选匹配计数">显示 {{ sorted.length }} / {{ rows.length }}</span>
          <button
            type="button"
            class="reset-filter-sort"
            :disabled="isDefaultFilterSort"
            aria-label="重置筛选与排序"
            @click="resetFilterSort"
          >
            重置筛选与排序
          </button>
        </div>
      </div>

      <!-- 批量锁定管理入口（Phase 3.15） -->
      <div class="batch-lock-entry">
        <button
          type="button"
          aria-label="打开批量锁定管理"
          @click="openBatchLockPanel"
        >
          批量设置锁定状态
        </button>
      </div>

      <!-- 成功 / 失败反馈 -->
      <div v-if="feedback" :class="['feedback', feedback.kind]" role="status">{{ feedback.message }}</div>

      <!-- 空结果（区分：合法空仓库 / 筛选无匹配） -->
      <div v-if="sorted.length === 0" class="empty-state">
        {{ rows.length === 0 ? '尚未获得符文' : '无匹配筛选结果' }}
      </div>

      <ul v-else class="rune-grid">
        <li v-for="row in sorted" :key="row.rune.id" class="rune-card" :data-rarity="row.rune.rarity">
          <div class="rune-head">
            <span class="rune-name">{{ row.displayName }}</span>
            <span class="rune-rarity">{{ row.rarityLabel }}</span>
          </div>
          <div class="rune-stat">属性：{{ statNames[row.stat] }}</div>
          <div class="rune-level">{{ row.experience.isMax ? `Lv.${row.rune.level} MAX` : `Lv.${row.rune.level}` }}</div>
          <div class="rune-base">基础 {{ statNames[row.stat] }} +{{ row.rune.statValue }}</div>
          <div class="rune-effective">当前 {{ statNames[row.stat] }} +{{ row.effectiveValue }}</div>
          <div class="rune-exp">经验 {{ row.experience.currentExp }} / {{ row.experience.requiredExp ?? 'MAX' }}</div>
          <div class="rune-status" :data-status="row.binding ? 'embedded' : 'unequipped'">
            <template v-if="row.binding">
              已镶嵌：{{ slotNames[row.binding.equipmentSlot] }} · 孔位 {{ row.binding.runeSlotIndex + 1 }}
            </template>
            <template v-else>未镶嵌</template>
          </div>
          <div class="rune-lock" :data-locked="row.isLocked ? 'true' : 'false'">
            {{ row.isLocked ? '已锁定' : '未锁定' }}
          </div>
          <div class="rune-actions">
            <button
              type="button"
              :aria-label="`镶嵌或移动 ${row.displayName}`"
              @click="openPicker(row.rune.id)"
            >
              {{ row.binding ? '移动' : '镶嵌' }}
            </button>
            <button
              v-if="row.binding"
              type="button"
              :aria-label="`移除 ${row.displayName}`"
              @click="confirmRemove(row)"
            >
              移除
            </button>
            <button
              type="button"
              class="lock-button"
              :aria-label="`${row.isLocked ? '解锁' : '锁定'} ${row.displayName}`"
              :data-locked="row.isLocked ? 'true' : 'false'"
              @click="toggleLock(row)"
            >
              {{ row.isLocked ? '解锁' : '锁定' }}
            </button>
            <button
              v-if="!row.experience.isMax"
              type="button"
              class="feed-button"
              :aria-label="`强化 ${row.displayName}`"
              @click="openFeedPanel(row.rune.id)"
            >
              强化
            </button>
            <button
              v-else
              type="button"
              class="feed-button"
              disabled
              :aria-label="`${row.displayName} 已满级`"
            >
              已满级
            </button>
          </div>
        </li>
      </ul>

      <!-- 镶嵌目标选择（数据来自 view.targets 快照，组件不再触碰原始 inventory/equipment） -->
      <div v-if="showPicker" class="picker" role="dialog" aria-label="选择镶嵌目标">
        <div class="picker-head">
          <span>镶嵌目标：{{ pickerRune?.displayName }}</span>
          <button type="button" aria-label="关闭镶嵌目标选择" @click="closePicker">关闭</button>
        </div>
        <div v-for="target in equippedTargets" :key="target.equipmentSlot" class="picker-target">
          <div class="picker-target-name">{{ slotNames[target.equipmentSlot] }} · {{ target.equipmentName }}</div>
          <div class="picker-slots">
            <button
              v-for="slotView in target.slots"
              :key="slotView.index"
              type="button"
              :aria-label="`镶嵌到 ${slotNames[target.equipmentSlot]} 孔位 ${slotView.index + 1}${slotView.currentRuneDisplayName ? '，当前 ' + slotView.currentRuneDisplayName : ''}`"
              @click="confirmEmbed(target.equipmentSlot, slotView.index)"
            >
              孔位 {{ slotView.index + 1 }}
              <span v-if="slotView.currentRuneDisplayName">（{{ slotView.currentRuneDisplayName }}）</span>
              <span v-else>（空）</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 强化面板（Phase 3.13 多选）：材料候选派生自纯视图 rows，预览复用 planRuneBatchFeeding -->
      <div v-if="showFeedPanel" class="feed-panel" role="dialog" aria-label="强化符文">
        <div class="feed-head">
          <span>强化目标：{{ feedTarget?.displayName }}（Lv.{{ feedTarget?.rune.level }}）</span>
          <button type="button" aria-label="关闭强化面板" @click="closeFeedPanel">关闭</button>
        </div>

        <div v-if="feedCandidates.length === 0" class="feed-empty">
          <p>暂无可用材料符文</p>
          <p>仅可消耗未镶嵌的 Lv.1 / 0 EXP 符文</p>
        </div>

        <ul v-else class="feed-materials" aria-label="强化材料候选">
            <li v-for="candidate in feedCandidates" :key="candidate.rune.id">
              <button
                type="button"
                class="feed-material"
                :data-selected="feedMaterialRuneIds.includes(candidate.rune.id) ? 'true' : 'false'"
                :aria-label="`${feedMaterialRuneIds.includes(candidate.rune.id) ? '取消选择' : '选择'}材料 ${candidate.displayName}，提供 ${feedExp(candidate.rune)} 经验，当前${feedMaterialRuneIds.includes(candidate.rune.id) ? '已选中' : '未选中'}`"
                :aria-pressed="feedMaterialRuneIds.includes(candidate.rune.id)"
                @click="toggleFeedMaterial(candidate.rune.id)"
              >
                <span class="feed-material-name">{{ candidate.displayName }}</span>
                <span class="feed-material-rarity">{{ candidate.rarityLabel }}</span>
                <span class="feed-material-exp">+{{ feedExp(candidate.rune) }} 经验</span>
              </button>
            </li>
          </ul>

          <div class="feed-selection-summary" role="status" aria-label="已选材料摘要">
            <span>已选 {{ feedSelectionSummary.count }} 枚</span>
            <span v-if="feedSelectionSummary.totalExp !== null">总计 +{{ feedSelectionSummary.totalExp }} EXP</span>
            <span v-else>总计 不可用</span>
            <span v-if="feedSelectionSummary.count === 0">尚未选择可消耗材料</span>
            <span v-else-if="feedSelectionSummary.totalExp !== null">确认后将永久消耗 {{ feedSelectionSummary.count }} 枚材料</span>
          </div>

          <div v-if="feedPreviewModel" class="feed-preview" role="status" aria-label="强化预览">
            <span>当前：Lv.{{ feedPreviewModel.currentLevel }} · EXP {{ feedPreviewModel.currentExp }} / {{ feedPreviewModel.currentRequiredExp ?? 'MAX' }}</span>
            <span>获得：+{{ feedPreviewModel.expAdded }} EXP</span>
            <span>强化后：Lv.{{ feedPreviewModel.nextLevel }} · EXP {{ feedPreviewModel.nextExp }} / {{ feedPreviewModel.nextRequiredExp ?? 'MAX' }}</span>
            <span>预计提升：{{ feedPreviewModel.levelsGained }} 级</span>
            <span>强化后有效属性：{{ feedPreviewModel.statName }} +{{ feedPreviewModel.nextEffectiveValue }}</span>
            <span>消耗：{{ feedPreviewModel.materialName }}</span>
          </div>

          <button
            v-if="feedCandidates.length > 0"
            type="button"
            class="feed-confirm"
            :disabled="!feedPreviewModel"
            :aria-label="`确认强化，将永久消耗 ${feedSelectionSummary.count} 枚材料`"
            @click="confirmFeed"
          >
            确认强化
          </button>
      </div>

      <!-- 批量锁定管理面板（Phase 3.15）：候选=完整合法仓库（不受外层筛选控制），
           预览复用 planRuneBatchLockChange，确认走 trySetRunesLocked 批量原子事务 -->
      <div v-if="showBatchLockPanel" class="batch-lock-panel" role="dialog" aria-label="批量锁定符文">
        <div class="batch-lock-head">
          <span>批量设置锁定状态</span>
          <button type="button" aria-label="关闭批量锁定管理" @click="closeBatchLockPanel">关闭</button>
        </div>

        <label class="batch-lock-target">
          目标状态
          <select aria-label="选择批量锁定目标状态" v-model="batchLockDesiredState">
            <option :value="true">锁定所选符文</option>
            <option :value="false">解锁所选符文</option>
          </select>
        </label>

        <ul class="batch-lock-list" aria-label="批量锁定候选符文">
          <li v-for="row in batchLockCandidates" :key="row.rune.id">
            <button
              type="button"
              class="batch-lock-item"
              :data-selected="batchLockRuneIds.includes(row.rune.id) ? 'true' : 'false'"
              :data-locked="row.isLocked ? 'true' : 'false'"
              :aria-pressed="batchLockRuneIds.includes(row.rune.id)"
              :aria-label="`${batchLockRuneIds.includes(row.rune.id) ? '取消选择符文' : '选择符文'} ${row.displayName}，当前${row.isLocked ? '已锁定' : '未锁定'}，${batchLockRuneIds.includes(row.rune.id) ? '已选中' : '未选中'}`"
              @click="toggleBatchLockRune(row.rune.id)"
            >
              <span class="batch-lock-name">{{ row.displayName }}</span>
              <span class="batch-lock-state">{{ row.isLocked ? '已锁定' : '未锁定' }}</span>
              <span class="batch-lock-picked">{{ batchLockRuneIds.includes(row.rune.id) ? '已选中' : '未选中' }}</span>
            </button>
          </li>
        </ul>

        <div class="batch-lock-summary" role="status" aria-label="批量锁定预览">
          <span>已选择 {{ batchLockRuneIds.length }} 枚</span>
          <span>目标状态：{{ batchLockDesiredState ? '锁定' : '解锁' }}</span>
          <template v-if="batchLockPreview">
            <span>将改变 {{ batchLockPreview.changedCount }} 枚</span>
            <span>已处于目标状态 {{ batchLockPreview.unchangedCount }} 枚</span>
            <span v-if="batchLockPreview.changedCount > 0">实际变化：{{ batchLockChangedNames }}</span>
            <span v-else>所有所选符文已处于目标状态</span>
          </template>
          <span v-else-if="batchLockRuneIds.length === 0">尚未选择符文</span>
          <span v-else>预览不可用</span>
        </div>

        <button
          type="button"
          class="batch-lock-confirm"
          :disabled="!batchLockPreview || batchLockPreview.changedCount === 0"
          :aria-label="`确认批量操作，将${batchLockDesiredState ? '锁定' : '解锁'} ${batchLockPreview ? batchLockPreview.changedCount : 0} 枚符文`"
          @click="confirmBatchLock"
        >
          确认{{ batchLockDesiredState ? '锁定' : '解锁' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped src="../styles/rune-inventory.css"></style>
