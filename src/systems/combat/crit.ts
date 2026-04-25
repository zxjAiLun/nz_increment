export type RNG = () => number

export function rollCrit(critChancePercent: number, rng: RNG = Math.random): boolean {
  const chance = Math.min(80, Math.max(0, critChancePercent))
  return rng() * 100 < chance
}
