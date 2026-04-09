const SAVE_KEY = 'lollipop_adventure_save'
const SAVE_VERSION = '1.0'

const CURRENT_VERSION = 2  // 每次破坏性变更+1

export function migrateSaveIfNeeded(data: SaveData): SaveData {
  const versionStr = data.version || '1.0'
  const version = parseFloat(versionStr)

  if (version >= CURRENT_VERSION) return data

  let migrated: SaveData = { ...data }

  // v1 → v2: 防御公式变更（×3 → ×1.5），旧存档怪物变弱属正常现象
  if (version < 2) {
    migrated = { ...migrated, version: '2.0', _migrationNote: 'v2: defense formula changed (×3 → ×1.5), old saves unchanged' }
  }

  return migrated
}

// 各模块存档数据的子类型（localStorage 反序列化允许 any）
export interface PlayerSaveData { [key: string]: unknown }
export interface MonsterSaveData { [key: string]: unknown }
export interface GameSaveData { [key: string]: unknown }
export interface AchievementSaveData { [key: string]: unknown }
export interface SkillSaveData { [key: string]: unknown }
export interface TrainingSaveData { [key: string]: unknown }
export interface RebirthSaveData { [key: string]: unknown }

export interface SaveData {
  version: string
  timestamp: number
  playerData: PlayerSaveData
  monsterData: MonsterSaveData
  gameData: GameSaveData
  achievementData: AchievementSaveData
  skillData: SkillSaveData
  trainingData: TrainingSaveData
  rebirthData: RebirthSaveData
}

// 静默的调试日志（生产环境不输出）
function silentError(..._args: unknown[]): void { /* noop */ }

export class StorageManager {
  static saveGame(data: SaveData): boolean {
    try {
      const saveString = JSON.stringify({
        ...data,
        version: SAVE_VERSION,
        timestamp: Date.now(),
      })
      localStorage.setItem(SAVE_KEY, saveString)
      return true
    } catch (error) {
      silentError('Save failed:', error)
      return false
    }
  }

  static loadGame(): SaveData | null {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) {
        return null
      }
      const data = JSON.parse(saveString) as SaveData
      return migrateSaveIfNeeded(data)
    } catch (error) {
      silentError('Load failed:', error)
      return null
    }
  }

  static exportSave(): string {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) {
        throw new Error('No save data found')
      }
      const compressed = btoa(unescape(encodeURIComponent(saveString)))
      return compressed
    } catch (error) {
      silentError('Export failed:', error)
      throw error
    }
  }

  static importSave(encodedData: string): boolean {
    try {
      const decoded = decodeURIComponent(escape(atob(encodedData)))
      const data = JSON.parse(decoded) as SaveData

      if (!this.validateSaveData(data)) {
        throw new Error('Invalid save data')
      }

      localStorage.setItem(SAVE_KEY, decoded)
      return true
    } catch (error) {
      silentError('Import failed:', error)
      return false
    }
  }

  static validateSaveData(data: unknown): data is SaveData {
    if (!data || typeof data !== 'object') return false
    const d = data as SaveData
    if (!d.version || !d.timestamp) return false
    if (!d.playerData || !d.monsterData) return false
    return true
  }

  static deleteSave(): boolean {
    try {
      localStorage.removeItem(SAVE_KEY)
      return true
    } catch (error) {
      silentError('Delete failed:', error)
      return false
    }
  }

  static hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null
  }

  static getSaveInfo(): { timestamp: number; version: string; size: number } | null {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) return null

      const data = JSON.parse(saveString) as SaveData
      return {
        timestamp: data.timestamp,
        version: data.version,
        size: saveString.length
      }
    } catch (error) {
      return null
    }
  }

  static backupSave(): string | null {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) return null

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = new Blob([saveString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = url
      a.download = `lollipop_backup_${timestamp}.json`
      a.click()

      URL.revokeObjectURL(url)
      return a.download
    } catch (error) {
      silentError('Backup failed:', error)
      return null
    }
  }
}
