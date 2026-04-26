import type { ChanceGameDefinition } from '../systems/probability/chanceGame'

export const CHANCE_GAMES: ChanceGameDefinition[] = [
  {
    id: 'pachinko',
    name: '幸运投球',
    cadence: 'prePull',
    output: 'modifier',
    description: '十连前投球，产出本次十连 modifier，不直接发最终奖励。',
    allowedModifierSources: ['pachinko', 'pity'],
    budget: {
      expectedValueBudget: 12,
      maxLegendaryRateBonus: 3,
      maxPityGainPerDay: 10,
      maxFreePullsPerWeek: 0,
      maxJackpotPerWeek: 1
    }
  },
  {
    id: 'pinball',
    name: '活动弹球机',
    cadence: 'shortRun',
    output: 'token',
    description: '短局分数转换为 token，再兑换抽卡 modifier。',
    allowedModifierSources: ['pinball', 'event'],
    budget: {
      expectedValueBudget: 20,
      maxLegendaryRateBonus: 2,
      maxPityGainPerDay: 10,
      maxFreePullsPerWeek: 0,
      maxJackpotPerWeek: 1
    }
  },
  {
    id: 'monopoly',
    name: '资源大富翁',
    cadence: 'weekly',
    output: 'route',
    description: '每日骰子推进周常地图，产出抽卡券、保底、定向 token 和概率券。',
    allowedModifierSources: ['monopoly', 'event'],
    budget: {
      expectedValueBudget: 35,
      maxLegendaryRateBonus: 2,
      maxPityGainPerDay: 21,
      maxFreePullsPerWeek: 5,
      maxJackpotPerWeek: 1
    }
  },
  {
    id: 'luckyWheel',
    name: '每日幸运转盘',
    cadence: 'daily',
    output: 'bonus',
    description: '每日免费一次，产出保底、抽卡券、rare+ 加成或流派 token。',
    allowedModifierSources: ['event', 'pity'],
    budget: {
      expectedValueBudget: 10,
      maxLegendaryRateBonus: 1,
      maxPityGainPerDay: 3,
      maxFreePullsPerWeek: 1,
      maxJackpotPerWeek: 0
    }
  }
]

export function getChanceGameDefinition(id: ChanceGameDefinition['id']): ChanceGameDefinition | null {
  return CHANCE_GAMES.find(game => game.id === id) ?? null
}
