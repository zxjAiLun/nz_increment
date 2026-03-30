import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGameStore } from '../stores/gameStore'
import { useTrainingStore } from '../stores/trainingStore'

export function useBattle() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const gameStore = useGameStore()
  const trainingStore = useTrainingStore()

  const TICK_INTERVAL = 100
  const TICK_RATE = TICK_INTERVAL / 1000
  let battleIntervalId: number | null = null
  let timeIntervalId: number | null = null
  let onlineTimeCounter = 0
  let autoSaveCounter = 0

  const battleMode = ref<'main' | 'training'>('main')

  const expNeeded = computed(() => playerStore.getExpNeeded())
  const expPercent = computed(() => Math.min(100, (playerStore.player.experience / expNeeded.value) * 100))
  const expPerSecond = computed(() => playerStore.getAverageExpPerSecond())
  const secondsToLevelUp = computed(() => playerStore.getSecondsToLevelUp())
  const currentDifficulty = computed(() => monsterStore.difficultyValue || 0)

  function switchBattleMode(mode: 'main' | 'training') {
    battleMode.value = mode
    if (mode === 'main') {
      gameStore.resumeBattle()
    }
  }

  function goBackLevels() {
    if (playerStore.player.diamond >= 50) {
      playerStore.player.diamond -= 50
      monsterStore.goBackLevels(10)
      playerStore.revive()
    }
  }

  function processTrainingBattle() {
    if (!trainingStore.currentTrainingMonster) {
      trainingStore.spawnTrainingMonster()
    }

    if (trainingStore.currentTrainingMonster) {
      const result = trainingStore.damageTrainingMonster(playerStore.totalStats.attack)

      if (result.killed) {
        playerStore.addGold(result.goldReward)
        playerStore.addExperience(result.expReward)
        if (result.diamondReward > 0) {
          playerStore.addDiamond(result.diamondReward)
        }
        if (result.shouldDropEquipment) {
          const equipment = playerStore.generateRandomEquipment()
          if (equipment) {
            playerStore.equipNewEquipment(equipment)
          }
        }
        if (result.statDrop) {
          playerStore.addStatReward(result.statDrop.type as 'attack' | 'defense' | 'maxHp' | 'speed', result.statDrop.value)
        }
        if (!result.autoUpgraded) {
          trainingStore.spawnTrainingMonster()
        }
      }

      if (playerStore.isDead()) {
        playerStore.revive()
      }
    }
  }

  function startBattleLoop() {
    battleIntervalId = window.setInterval(() => {
      if (gameStore.isPaused) return

      if (battleMode.value === 'training') {
        processTrainingBattle()
      } else {
        gameStore.gameLoop(TICK_RATE)
      }
    }, TICK_INTERVAL)

    timeIntervalId = window.setInterval(() => {
      if (!gameStore.isPaused) {
        onlineTimeCounter++
        autoSaveCounter++
        playerStore.pruneExpiredBuffs()
        if (onlineTimeCounter >= 1) {
          playerStore.updateOnlineTime(1)
          const expGain = playerStore.getExpPerSecond()
          if (expGain > 0) {
            playerStore.addExperience(expGain)
          }
          onlineTimeCounter = 0
        }
        if (autoSaveCounter >= 30) {
          playerStore.saveGame()
          autoSaveCounter = 0
        }
      }
    }, 1000)
  }

  function stopBattleLoop() {
    if (battleIntervalId) clearInterval(battleIntervalId)
    if (timeIntervalId) clearInterval(timeIntervalId)
    playerStore.saveGame()
  }

  onMounted(() => {
    try {
      playerStore.loadGame()

      if (playerStore.player.currentHp <= 0) {
        playerStore.player.currentHp = playerStore.player.maxHp
      }

      if (!monsterStore.currentMonster) {
        monsterStore.initMonster()
      }

      startBattleLoop()
    } catch (e) {
    }
  })

  onUnmounted(() => {
    stopBattleLoop()
  })

  return {
    battleMode,
    expNeeded,
    expPercent,
    expPerSecond,
    secondsToLevelUp,
    currentDifficulty,
    switchBattleMode,
    goBackLevels,
    startBattleLoop,
    stopBattleLoop
  }
}
