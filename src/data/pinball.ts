export interface PinballScoreBand {
  id: string
  name: string
  minScore: number
  tokens: number
}

export const PINBALL_SCORE_BANDS: PinballScoreBand[] = [
  { id: 'steady', name: '稳定命中', minScore: 0, tokens: 1 },
  { id: 'combo', name: '连击区', minScore: 240, tokens: 2 },
  { id: 'jackpot', name: '高分区', minScore: 420, tokens: 3 }
]

export const PINBALL_MAX_TOKENS_PER_PLAY = 3
export const PINBALL_TOKEN_TO_RARE_PLUS = 1
export const PINBALL_MAX_CONVERT_TOKENS = 10
