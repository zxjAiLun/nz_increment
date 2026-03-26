const SAVE_KEY = 'lollipop_adventure_save'
const SAVE_VERSION = '1.0'

export interface SaveData {
  version: string
  timestamp: number
  playerData: any
  monsterData: any
  gameData: any
  achievementData: any
  skillData: any
  trainingData: any
  rebirthData: any
}

export class StorageManager {
  static saveGame(data: SaveData): boolean {
    try {
      const saveString = JSON.stringify({
        version: SAVE_VERSION,
        timestamp: Date.now(),
        ...data
      })
      localStorage.setItem(SAVE_KEY, saveString)
      console.log(`游戏已保存，数据大小: ${saveString.length} 字节`)
      return true
    } catch (error) {
      console.error('保存游戏失败:', error)
      return false
    }
  }

  static loadGame(): SaveData | null {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) {
        console.log('没有找到存档')
        return null
      }
      const data = JSON.parse(saveString) as SaveData
      console.log(`游戏已加载，存档版本: ${data.version}，保存时间: ${new Date(data.timestamp).toLocaleString()}`)
      return data
    } catch (error) {
      console.error('加载游戏失败:', error)
      return null
    }
  }

  static exportSave(): string {
    try {
      const saveString = localStorage.getItem(SAVE_KEY)
      if (!saveString) {
        throw new Error('没有找到存档')
      }
      const compressed = btoa(unescape(encodeURIComponent(saveString)))
      return compressed
    } catch (error) {
      console.error('导出存档失败:', error)
      throw error
    }
  }

  static importSave(encodedData: string): boolean {
    try {
      const decoded = decodeURIComponent(escape(atob(encodedData)))
      const data = JSON.parse(decoded) as SaveData
      
      if (!this.validateSaveData(data)) {
        throw new Error('存档数据无效')
      }
      
      localStorage.setItem(SAVE_KEY, decoded)
      console.log('存档导入成功')
      return true
    } catch (error) {
      console.error('导入存档失败:', error)
      return false
    }
  }

  static validateSaveData(data: any): data is SaveData {
    if (!data || typeof data !== 'object') return false
    if (!data.version || !data.timestamp) return false
    if (!data.playerData || !data.monsterData) return false
    return true
  }

  static deleteSave(): boolean {
    try {
      localStorage.removeItem(SAVE_KEY)
      console.log('存档已删除')
      return true
    } catch (error) {
      console.error('删除存档失败:', error)
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
      console.error('备份存档失败:', error)
      return null
    }
  }
}
