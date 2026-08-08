import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { BATTLE_PASS_REWARDS, type BattlePassReward } from '../data/battlePassRewards'
import { usePlayerStore } from './playerStore'
import { compensateStorageRaws } from '../utils/storageCompensation'

export { type BattlePassReward }

export interface BattlePassRewardItem {
  type: string
  amount: number
}

const BATTLE_PASS_KEY = 'nz_battle_pass'
const MAIN_SAVE_KEY = 'lollipop_adventure_save'
const LEGACY_BATTLEPASS_KEY = 'nz_battlepass_v1'

function loadState() {
  try {
    const saved = localStorage.getItem(BATTLE_PASS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveState(state: any): boolean {
  try {
    localStorage.setItem(BATTLE_PASS_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const useBattlePassStore = defineStore('battlePass', () => {
  const saved = loadState()
  const currentLevel = ref(saved?.currentLevel ?? 1)
  const totalExp = ref(saved?.totalExp ?? 0)
  const expToNextLevel = ref(saved?.expToNextLevel ?? 100)
  const isPremium = ref(saved?.isPremium ?? false)
  // Phase 3.80：free / premium 两轨独立 marker。legacy claimedLevels 迁移：
  // 旧实现对 Premium 用户一次 claim 同时发两轨，故旧值同时视为 free + premium claimed，
  // 优先避免旧用户重复领取；新字段存在时优先用新字段，legacy 不得覆盖。
  const claimedFreeLevels = ref<number[]>(
    Array.isArray(saved?.claimedFreeLevels)
      ? [...saved.claimedFreeLevels]
      : Array.isArray(saved?.claimedLevels)
        ? [...saved.claimedLevels]
        : []
  )
  const claimedPremiumLevels = ref<number[]>(
    Array.isArray(saved?.claimedPremiumLevels)
      ? [...saved.claimedPremiumLevels]
      : Array.isArray(saved?.claimedLevels)
        ? [...saved.claimedLevels]
        : []
  )
  const seasonStartTime = ref(saved?.seasonStartTime ?? Date.now())
  const seasonDaysLeft = ref(saved?.seasonDaysLeft ?? 60)

  // 新保存格式：只写两轨，不再产生 legacy claimedLevels。
  function persistState() {
    return {
      currentLevel: currentLevel.value,
      totalExp: totalExp.value,
      expToNextLevel: expToNextLevel.value,
      isPremium: isPremium.value,
      claimedFreeLevels: claimedFreeLevels.value,
      claimedPremiumLevels: claimedPremiumLevels.value,
      seasonStartTime: seasonStartTime.value,
      seasonDaysLeft: seasonDaysLeft.value
    }
  }

  // Persist on change（level/exp/premium 等；claim 路径不依赖本 watch，另有显式同步保存）
  watch([currentLevel, totalExp, isPremium, claimedFreeLevels, claimedPremiumLevels], () => {
    saveState(persistState())
  })

  function expRequiredForLevel(level: number): number {
    return Math.floor(100 * Math.pow(1.15, level - 1))
  }

  function setPremium(value: boolean) {
    isPremium.value = value
  }

  function addExp(amount: number) {
    totalExp.value += amount
    while (totalExp.value >= expToNextLevel.value && currentLevel.value < 50) {
      totalExp.value -= expToNextLevel.value
      currentLevel.value++
      expToNextLevel.value = expRequiredForLevel(currentLevel.value)
    }
  }

  // Phase 3.80：显式 track claim。只返回被点击那一轨的奖励 item；track marker
  // 必须先经 nz_battle_pass 同步保存成功才保留，保存失败精确回滚 marker 并返回 null。
  function claimLevelReward(level: number, track: 'free' | 'premium'): BattlePassRewardItem | null {
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (currentLevel.value < level) return null  // Level prerequisite
    const item = track === 'free' ? reward.free : reward.premium
    if (!item) return null
    if (track === 'premium' && !isPremium.value) return null
    const markers = track === 'free' ? claimedFreeLevels : claimedPremiumLevels
    if (markers.value.includes(level)) return null
    markers.value.push(level)
    if (!saveState(persistState())) {
      // 原地回滚（eligibility 已保证 level 不存在，push 后 pop 精确）；不替换 ref identity，
      // 避免 3.80 shallow watcher 在失败返回后产生延迟写盘（Phase 3.83）。
      markers.value.pop()
      return null
    }
    return { type: item.type, amount: item.amount }
  }

  // Phase 3.81：live premium diamond 跨存储补偿事务（Main + nz_battle_pass）。
  // 资格门（不读 Date.now）→ amount/overflow 门 → timestamp → 候选前 raw 预读
  // → 纯内存候选 → Main（saveGame(ts)）→ BattlePass（3.80 新格式）
  // → 失败精确回滚 + 逆序 raw 补偿；补偿失败抛固定错误。无 retry。
  function claimPremiumDiamondReward(
    level: number,
    options?: { now?: number },
  ): BattlePassRewardItem | null {
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (currentLevel.value < level) return null  // Level prerequisite
    const item = reward.premium
    if (!item) return null
    if (item.type !== 'diamond') return null
    if (!isPremium.value) return null
    if (claimedPremiumLevels.value.includes(level)) return null

    const amount = item.amount
    if (!Number.isSafeInteger(amount) || amount <= 0) return null  // 损坏 amount fail closed

    const playerStore = usePlayerStore()
    const cur = playerStore.player.diamond
    if (!Number.isSafeInteger(cur) || !Number.isSafeInteger(cur + amount)) return null

    let ts: number
    try {
      ts = options?.now ?? Date.now()
    } catch {
      return null
    }
    if (!Number.isSafeInteger(ts) || ts <= 0) return null

    // 快照（候选前）
    const prevDiamond = cur
    const prevCheckpoint = playerStore.lastOfflineCheckpointAt
    const prevPremiumMarkers = [...claimedPremiumLevels.value]

    // 候选前 raw 预读：任一 getItem 抛错 → 零 mutation 零写盘
    let prevMainRaw: string | null
    try {
      prevMainRaw = localStorage.getItem(MAIN_SAVE_KEY)
      localStorage.getItem(BATTLE_PASS_KEY)
    } catch {
      return null
    }

    // 纯内存候选
    claimedPremiumLevels.value.push(level)
    playerStore.player.diamond += amount

    function restore() {
      playerStore.player.diamond = prevDiamond
      playerStore.lastOfflineCheckpointAt = prevCheckpoint
      // 原地恢复（保持数组 identity）：不替换 ref 引用，避免触发 3.80 的 shallow watcher
      // 在事务失败返回后产生延迟 BattlePass 写盘（Phase 3.81 Repair 1）。
      claimedPremiumLevels.value.splice(0, claimedPremiumLevels.value.length, ...prevPremiumMarkers)
    }

    // 阶段一：Main 先写（false / throw 统一视为失败）
    let mainSaved = false
    try {
      mainSaved = playerStore.saveGame(ts)
    } catch {
      mainSaved = false
    }
    if (!mainSaved) {
      restore()
      return null
    }
    // 阶段二：BattlePass 后写（3.80 新格式，不含 legacy claimedLevels）
    if (!saveState(persistState())) {
      restore()
      compensateStorageRaws(
        [[MAIN_SAVE_KEY, prevMainRaw]],
        'live battle pass premium diamond claim persistence rollback failed',
      )
      return null
    }
    return { type: 'diamond', amount }
  }

  // Phase 3.82：live free gold 三存储补偿事务（legacy nz_battlepass_v1 → Main → nz_battle_pass）。
  // 资格门（不读 Date.now）→ amount/gold/legacy BP 验证 → timestamp → 三份 raw 预读
  // → 纯内存候选（marker + applyGoldRewardInMemory）→ legacy → Main → live 顺序落盘
  // → 任一步失败精确回滚 + 逆序 raw 补偿；补偿失败抛固定错误。无 retry。
  function claimFreeGoldReward(
    level: number,
    options?: { now?: number },
  ): BattlePassRewardItem | null {
    const reward = BATTLE_PASS_REWARDS.find(r => r.level === level)
    if (!reward) return null
    if (currentLevel.value < level) return null  // Level prerequisite
    const item = reward.free
    if (!item) return null
    if (item.type !== 'gold') return null
    if (claimedFreeLevels.value.includes(level)) return null

    const amount = item.amount
    if (!Number.isSafeInteger(amount) || amount <= 0) return null  // 损坏 amount fail closed

    const playerStore = usePlayerStore()
    const curGold = playerStore.player.gold
    if (!Number.isSafeInteger(curGold) || curGold < 0) return null
    if (!Number.isSafeInteger(curGold + amount)) return null

    // legacy BP 前置验证：本事务将推进其 level/exp（只验证将修改的字段，不触碰其它字段）
    const legacyBp = playerStore.battlePass
    if (!Number.isSafeInteger(legacyBp.level) || legacyBp.level < 0) return null
    if (!Number.isSafeInteger(legacyBp.exp) || legacyBp.exp < 0) return null

    let ts: number
    try {
      ts = options?.now ?? Date.now()
    } catch {
      return null
    }
    if (!Number.isSafeInteger(ts) || ts <= 0) return null

    // 快照（只含本事务修改的状态；不替换 playerStore.battlePass 或 claimedFreeLevels 的 identity）
    const prevGold = curGold
    const prevCheckpoint = playerStore.lastOfflineCheckpointAt
    const prevLegacyLevel = legacyBp.level
    const prevLegacyExp = legacyBp.exp
    const prevFreeMarkers = [...claimedFreeLevels.value]

    // 三份 raw 预读：任一 getItem 抛错 → 零 mutation 零写盘
    let prevLegacyRaw: string | null
    let prevMainRaw: string | null
    try {
      prevLegacyRaw = localStorage.getItem(LEGACY_BATTLEPASS_KEY)
      prevMainRaw = localStorage.getItem(MAIN_SAVE_KEY)
      localStorage.getItem(BATTLE_PASS_KEY)
    } catch {
      return null
    }

    // 纯内存候选（不写任何 storage）
    claimedFreeLevels.value.push(level)
    playerStore.applyGoldRewardInMemory(amount)

    function restore() {
      playerStore.player.gold = prevGold
      playerStore.lastOfflineCheckpointAt = prevCheckpoint
      legacyBp.level = prevLegacyLevel
      legacyBp.exp = prevLegacyExp
      // 原地恢复（保持数组 identity），避免触发 3.80 shallow watcher 的延迟写盘（3.81 R1 教训）
      claimedFreeLevels.value.splice(0, claimedFreeLevels.value.length, ...prevFreeMarkers)
    }

    // Stage 1：legacy BattlePass（throw 即失败）
    try {
      playerStore.saveBattlePassData()
    } catch {
      restore()
      return null
    }
    // Stage 2：Main（false / throw 统一失败）
    let mainSaved = false
    try {
      mainSaved = playerStore.saveGame(ts)
    } catch {
      mainSaved = false
    }
    if (!mainSaved) {
      restore()
      compensateStorageRaws(
        [[LEGACY_BATTLEPASS_KEY, prevLegacyRaw]],
        'live battle pass free gold claim persistence rollback failed',
      )
      return null
    }
    // Stage 3：live BattlePass marker（3.80 新格式）
    if (!saveState(persistState())) {
      restore()
      // 逆序补偿已落盘的 Main 与 legacy BP（helper 逆序遍历：Main 先、legacy 后）
      compensateStorageRaws(
        [
          [LEGACY_BATTLEPASS_KEY, prevLegacyRaw],
          [MAIN_SAVE_KEY, prevMainRaw],
        ],
        'live battle pass free gold claim persistence rollback failed',
      )
      return null
    }
    return { type: 'gold', amount }
  }

  return {
    currentLevel, totalExp, expToNextLevel, isPremium,
    claimedFreeLevels, claimedPremiumLevels,
    seasonStartTime, seasonDaysLeft, addExp, claimLevelReward,
    claimPremiumDiamondReward, claimFreeGoldReward, setPremium
  }
})
