import type { Achievement, Player } from '../types'
import { generateId } from './calc'

export function createDefaultAchievements(): Achievement[] {
  return [
    { id: generateId(), category: 'kill', name: '初出茅庐', description: '累计击杀100只怪物', requirement: 100, progress: 0, completed: false, reward: { gold: 100 } },
    { id: generateId(), category: 'kill', name: '小有名气', description: '累计击杀1K只怪物', requirement: 1000, progress: 0, completed: false, reward: { gold: 1000 } },
    { id: generateId(), category: 'kill', name: '声名鹊起', description: '累计击杀10K只怪物', requirement: 10000, progress: 0, completed: false, reward: { gold: 10000, diamond: 10 } },
    { id: generateId(), category: 'kill', name: '名震天下', description: '累计击杀100K只怪物', requirement: 100000, progress: 0, completed: false, reward: { gold: 100000, diamond: 50 } },
    { id: generateId(), category: 'kill', name: '传说猎人', description: '累计击杀1M只怪物', requirement: 1000000, progress: 0, completed: false, reward: { gold: 1000000, diamond: 200, permanentBonus: { attack: 10 } } },
    { id: generateId(), category: 'kill', name: '新手杀手', description: '累计击杀50只怪物', requirement: 50, progress: 0, completed: false, reward: { gold: 50 } },
    { id: generateId(), category: 'kill', name: '怪物克星', description: '累计击杀500只怪物', requirement: 500, progress: 0, completed: false, reward: { gold: 500 } },
    { id: generateId(), category: 'kill', name: '怪物屠夫', description: '累计击杀5K只怪物', requirement: 5000, progress: 0, completed: false, reward: { gold: 5000 } },
    { id: generateId(), category: 'kill', name: '战场狂魔', description: '累计击杀500K只怪物', requirement: 500000, progress: 0, completed: false, reward: { gold: 500000, diamond: 100 } },
    
    { id: generateId(), category: 'growth', name: '初具规模', description: '攻击力突破100', requirement: 100, progress: 0, completed: false, reward: { gold: 500 } },
    { id: generateId(), category: 'growth', name: '小有所成', description: '攻击力突破1K', requirement: 1000, progress: 0, completed: false, reward: { gold: 5000, permanentBonus: { attack: 5 } } },
    { id: generateId(), category: 'growth', name: '登堂入室', description: '攻击力突破10K', requirement: 10000, progress: 0, completed: false, reward: { gold: 50000, permanentBonus: { attack: 20 } } },
    { id: generateId(), category: 'growth', name: '登峰造极', description: '攻击力突破100K', requirement: 100000, progress: 0, completed: false, reward: { gold: 500000, diamond: 100, permanentBonus: { attack: 50 } } },
    { id: generateId(), category: 'growth', name: '超凡入圣', description: '攻击力突破1M', requirement: 1000000, progress: 0, completed: false, reward: { gold: 5000000, diamond: 500, permanentBonus: { attack: 200 } } },
    { id: generateId(), category: 'growth', name: '坚不可摧', description: '防御力突破100', requirement: 100, progress: 0, completed: false, reward: { gold: 500, permanentBonus: { defense: 5 } } },
    { id: generateId(), category: 'growth', name: '铜墙铁壁', description: '防御力突破1K', requirement: 1000, progress: 0, completed: false, reward: { gold: 5000, permanentBonus: { defense: 20 } } },
    { id: generateId(), category: 'growth', name: '生命之力', description: '最大生命突破1K', requirement: 1000, progress: 0, completed: false, reward: { gold: 3000, permanentBonus: { maxHp: 100 } } },
    { id: generateId(), category: 'growth', name: '生生不息', description: '最大生命突破10K', requirement: 10000, progress: 0, completed: false, reward: { gold: 30000, permanentBonus: { maxHp: 500 } } },
    { id: generateId(), category: 'growth', name: '暴击达人', description: '暴击率突破30%', requirement: 30, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { critRate: 3 } } },
    { id: generateId(), category: 'growth', name: '暴击狂热', description: '暴击伤害突破200%', requirement: 200, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { critDamage: 10 } } },
    
    { id: generateId(), category: 'equipment', name: '初获装备', description: '获得第一件装备', requirement: 1, progress: 0, completed: false, reward: { gold: 100 } },
    { id: generateId(), category: 'equipment', name: '装备收集者', description: '获得10件装备', requirement: 10, progress: 0, completed: false, reward: { gold: 1000 } },
    { id: generateId(), category: 'equipment', name: '稀有猎手', description: '获得第一件史诗装备', requirement: 1, progress: 0, completed: false, reward: { gold: 5000, diamond: 20 } },
    { id: generateId(), category: 'equipment', name: '传说收藏家', description: '获得第一件传说装备', requirement: 1, progress: 0, completed: false, reward: { gold: 50000, diamond: 100 } },
    { id: generateId(), category: 'equipment', name: '神话降临', description: '获得第一件神话装备', requirement: 1, progress: 0, completed: false, reward: { gold: 500000, diamond: 500 } },
    { id: generateId(), category: 'equipment', name: '远古守护', description: '获得第一件远古装备', requirement: 1, progress: 0, completed: false, reward: { gold: 2000000, diamond: 1000 } },
    { id: generateId(), category: 'equipment', name: '永恒传说', description: '获得第一件永恒装备', requirement: 1, progress: 0, completed: false, reward: { gold: 10000000, diamond: 5000 } },
    { id: generateId(), category: 'equipment', name: '精良收藏', description: '获得5件精良装备', requirement: 5, progress: 0, completed: false, reward: { gold: 500 } },
    { id: generateId(), category: 'equipment', name: '史诗套装', description: '获得3件史诗装备', requirement: 3, progress: 0, completed: false, reward: { gold: 5000 } },
    
    { id: generateId(), category: 'phase', name: '建筑穿越者', description: '击穿建筑物', requirement: 1, progress: 0, completed: false, reward: { gold: 1000, permanentBonus: { attack: 5 } } },
    { id: generateId(), category: 'phase', name: '城市征服者', description: '击穿城市', requirement: 2, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { attack: 20 } } },
    { id: generateId(), category: 'phase', name: '地理探索者', description: '击穿地理', requirement: 3, progress: 0, completed: false, reward: { gold: 100000, permanentBonus: { attack: 100 } } },
    { id: generateId(), category: 'phase', name: '星球毁灭者', description: '击穿星球', requirement: 4, progress: 0, completed: false, reward: { gold: 1000000, diamond: 200, permanentBonus: { attack: 500 } } },
    { id: generateId(), category: 'phase', name: '恒星系领主', description: '击穿恒星系', requirement: 5, progress: 0, completed: false, reward: { gold: 10000000, diamond: 1000, permanentBonus: { attack: 2000 } } },
    { id: generateId(), category: 'phase', name: '星系主宰', description: '击穿星系', requirement: 6, progress: 0, completed: false, reward: { gold: 100000000, diamond: 5000, permanentBonus: { attack: 10000 } } },
    { id: generateId(), category: 'phase', name: '宇宙吞噬者', description: '击穿宇宙', requirement: 7, progress: 0, completed: false, reward: { gold: 1000000000, diamond: 20000, permanentBonus: { attack: 50000 } } },
    
    { id: generateId(), category: 'wealth', name: '小康生活', description: '累计获得10K金币', requirement: 10000, progress: 0, completed: false, reward: { gold: 0 } },
    { id: generateId(), category: 'wealth', name: '富裕阶层', description: '累计获得100K金币', requirement: 100000, progress: 0, completed: false, reward: { gold: 0 } },
    { id: generateId(), category: 'wealth', name: '百万富翁', description: '累计获得1M金币', requirement: 1000000, progress: 0, completed: false, reward: { diamond: 50 } },
    { id: generateId(), category: 'wealth', name: '亿万富翁', description: '累计获得1B金币', requirement: 1000000000, progress: 0, completed: false, reward: { diamond: 500 } },
    { id: generateId(), category: 'wealth', name: '钻石收藏家', description: '累计获得100钻石', requirement: 100, progress: 0, completed: false, reward: { gold: 0 } },
    { id: generateId(), category: 'wealth', name: '钻石大户', description: '累计获得1K钻石', requirement: 1000, progress: 0, completed: false, reward: { gold: 0 } },
    { id: generateId(), category: 'wealth', name: '钻石狂人', description: '累计获得10K钻石', requirement: 10000, progress: 0, completed: false, reward: { gold: 0 } },
    
    { id: generateId(), category: 'time', name: '初学者', description: '累计在线1小时', requirement: 3600, progress: 0, completed: false, reward: { gold: 500 } },
    { id: generateId(), category: 'time', name: '常驻玩家', description: '累计在线24小时', requirement: 86400, progress: 0, completed: false, reward: { gold: 5000, diamond: 10 } },
    { id: generateId(), category: 'time', name: '肝帝', description: '累计在线100小时', requirement: 360000, progress: 0, completed: false, reward: { gold: 50000, diamond: 100 } },
    { id: generateId(), category: 'time', name: '离线达人', description: '累计离线10小时', requirement: 36000, progress: 0, completed: false, reward: { offlineEfficiencyBonus: 10 } },
    { id: generateId(), category: 'time', name: '夜猫子', description: '累计在线500小时', requirement: 1800000, progress: 0, completed: false, reward: { gold: 500000, diamond: 500, offlineEfficiencyBonus: 20 } },
    { id: generateId(), category: 'time', name: '永恒守护', description: '累计在线1000小时', requirement: 3600000, progress: 0, completed: false, reward: { gold: 1000000, diamond: 1000, offlineEfficiencyBonus: 30 } },
    
    { id: generateId(), category: 'combo', name: '连击新手', description: '达成100连击', requirement: 100, progress: 0, completed: false, reward: { gold: 1000, permanentBonus: { speed: 1 } } },
    { id: generateId(), category: 'combo', name: '连击达人', description: '达成1K连击', requirement: 1000, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { speed: 3 } } },
    { id: generateId(), category: 'combo', name: '连击大师', description: '达成10K连击', requirement: 10000, progress: 0, completed: false, reward: { gold: 100000, permanentBonus: { speed: 5 } } },
    { id: generateId(), category: 'combo', name: '连击王者', description: '达成100K连击', requirement: 100000, progress: 0, completed: false, reward: { gold: 1000000, diamond: 200, permanentBonus: { speed: 10 } } },
    { id: generateId(), category: 'combo', name: '极速战士', description: '速度突破50', requirement: 50, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { speed: 5 } } },
    
    { id: generateId(), category: 'special', name: '一击必杀', description: '单次暴击伤害超过10K', requirement: 10000, progress: 0, completed: false, reward: { diamond: 100, permanentBonus: { critDamage: 10 } } },
    { id: generateId(), category: 'special', name: '致命一击', description: '单次暴击伤害超过100K', requirement: 100000, progress: 0, completed: false, reward: { diamond: 500, permanentBonus: { critDamage: 20 } } },
    { id: generateId(), category: 'special', name: '毁灭之击', description: '单次暴击伤害超过1M', requirement: 1000000, progress: 0, completed: false, reward: { diamond: 2000, permanentBonus: { critDamage: 50 } } },
    { id: generateId(), category: 'special', name: '不屈战士', description: '死亡次数达到100', requirement: 100, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { defense: 10 } } },
    { id: generateId(), category: 'special', name: '幸运儿', description: '幸运值突破50', requirement: 50, progress: 0, completed: false, reward: { diamond: 200, offlineEfficiencyBonus: 15 } },
    { id: generateId(), category: 'special', name: '全能战士', description: '同时解锁全部基础属性', requirement: 4, progress: 0, completed: false, reward: { gold: 50000, permanentBonus: { attack: 50, defense: 50, maxHp: 500 } } },
    
    { id: generateId(), category: 'rebirth', name: '初次转生', description: '完成第一次转生', requirement: 1, progress: 0, completed: false, reward: { gold: 10000, diamond: 100 } },
    { id: generateId(), category: 'rebirth', name: '转生达人', description: '完成10次转生', requirement: 10, progress: 0, completed: false, reward: { diamond: 500, permanentBonus: { attack: 100 } } },
    { id: generateId(), category: 'rebirth', name: '转生大师', description: '完成50次转生', requirement: 50, progress: 0, completed: false, reward: { diamond: 2000, permanentBonus: { attack: 500 } } },
    
    { id: generateId(), category: 'skill', name: '技能学徒', description: '学习第一个技能', requirement: 1, progress: 0, completed: false, reward: { gold: 500 } },
    { id: generateId(), category: 'skill', name: '技能大师', description: '学习5个技能', requirement: 5, progress: 0, completed: false, reward: { gold: 5000, permanentBonus: { critRate: 5 } } },
    { id: generateId(), category: 'skill', name: '技能宗师', description: '解锁全部技能槽', requirement: 5, progress: 0, completed: false, reward: { gold: 10000, permanentBonus: { speed: 10 } } },
    
    { id: generateId(), category: 'training', name: '练功房初探', description: '练功房等级达到10', requirement: 10, progress: 0, completed: false, reward: { gold: 5000 } },
    { id: generateId(), category: 'training', name: '练功狂人', description: '练功房等级达到50', requirement: 50, progress: 0, completed: false, reward: { gold: 50000, permanentBonus: { attack: 30 } } },
    { id: generateId(), category: 'training', name: '练功宗师', description: '练功房等级达到100', requirement: 100, progress: 0, completed: false, reward: { gold: 500000, permanentBonus: { attack: 100 } } },
  ]
}

export function checkAchievements(player: Player, achievements: Achievement[]): Achievement[] {
  const newlyCompleted: Achievement[] = []
  
  for (const achievement of achievements) {
    if (achievement.completed) continue
    
    let progress = 0
    switch (achievement.category) {
      case 'kill':
        progress = player.totalKillCount
        break
      case 'growth':
        progress = player.stats.attack
        break
      case 'wealth':
        progress = player.gold
        break
      case 'time':
        progress = player.totalOnlineTime
        break
      case 'combo':
        progress = player.maxComboCount
        break
      case 'phase':
        progress = player.unlockedPhases[player.unlockedPhases.length - 1] || 1
        break
      case 'equipment':
        const equipCount = Object.keys(player.equipment).length
        progress = equipCount
        break
    }
    
    achievement.progress = progress
    if (progress >= achievement.requirement && !achievement.completed) {
      achievement.completed = true
      newlyCompleted.push(achievement)
    }
  }
  
  return newlyCompleted
}

export function applyAchievementReward(player: Player, achievement: Achievement): void {
  if (achievement.reward.gold) {
    player.gold += achievement.reward.gold
  }
  if (achievement.reward.diamond) {
    player.diamond += achievement.reward.diamond
  }
  if (achievement.reward.permanentBonus) {
    Object.assign(player.stats, achievement.reward.permanentBonus)
  }
  if (achievement.reward.offlineEfficiencyBonus) {
    player.offlineEfficiencyBonus += achievement.reward.offlineEfficiencyBonus
  }
}
