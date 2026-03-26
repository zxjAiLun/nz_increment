import { onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '../stores/playerStore'
import { useMonsterStore } from '../stores/monsterStore'
import { useGameStore } from '../stores/gameStore'

const TICK_INTERVAL = 100

export function useGameLoop() {
  const playerStore = usePlayerStore()
  const monsterStore = useMonsterStore()
  const gameStore = useGameStore()

  let battleIntervalId: number | null = null
  let timeIntervalId: number | null = null
  let onlineTimeCounter = 0
  let autoSaveCounter = 0

  function start() {
    battleIntervalId = window.setInterval(() => {
      if (gameStore.isPaused) return
      gameStore.gameLoop(TICK_INTERVAL / 1000)
    }, TICK_INTERVAL)

    timeIntervalId = window.setInterval(() => {
      if (!gameStore.isPaused) {
        onlineTimeCounter++
        autoSaveCounter++
        playerStore.pruneExpiredBuffs()
        if (onlineTimeCounter >= 1) {
          playerStore.updateOnlineTime(1)
          const expGain = playerStore.getExpPerSecond()
          if (expGain > 0) playerStore.addExperience(expGain)
          onlineTimeCounter = 0
        }
        if (autoSaveCounter >= 30) {
          playerStore.saveGame()
          autoSaveCounter = 0
        }
      }
    }, 1000)
  }

  function stop() {
    if (battleIntervalId) clearInterval(battleIntervalId)
    if (timeIntervalId) clearInterval(timeIntervalId)
    playerStore.saveGame()
  }

  function init() {
    try {
      playerStore.loadGame()
      if (playerStore.player.currentHp <= 0) {
        playerStore.player.currentHp = playerStore.player.maxHp
      }
      if (!monsterStore.currentMonster) {
        monsterStore.initMonster()
      }
      start()
    } catch (e) {
      console.error('Error initializing battle:', e)
    }
  }

  onMounted(() => {
    init()
  })

  onUnmounted(() => {
    stop()
  })

  return { start, stop, init }
}
