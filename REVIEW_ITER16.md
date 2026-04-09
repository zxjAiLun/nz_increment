# Review: iter-16/daily-boss (commit 112ca31)

## Branch & Commit
- Branch: `iter-16/daily-boss`
- Commit: `112ca31`
- Message: "iter-16: daily/weekly challenge system - challengeStore, ChallengePanel, challengeGenerator"

## Files Changed (4 files, +294 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `src/types/challenge.ts` | +31 | Type definitions |
| `src/utils/challengeGenerator.ts` | +66 | Challenge factory |
| `src/stores/challengeStore.ts` | +55 | Store with progress/reward logic |
| `src/components/ChallengePanel.vue` | +142 | Daily + weekly challenge UI |

## Verification

```bash
$ grep -n "useChallengeStore\|generateDaily\|Challenge" src/stores/challengeStore.ts
3:import { generateDailyChallenges, generateWeeklyChallenges } from '../utils/challengeGenerator'
4:import type { Challenge, ChallengeProgress, ChallengeCondition } from '../types/challenge'
6:export const useChallengeStore = defineStore('challenge', () => {
7:  const dailyChallenges = ref<Challenge[]>(generateDailyChallenges())
8:  const weeklyChallenges = ref<Challenge[]>(generateWeeklyChallenges())
9:  const progress = ref<ChallengeProgress[]>([])
12:    const all = [...dailyChallenges.value, ...weeklyChallenges.value]
21:  function updateProgress(type: ChallengeCondition['type'], value: number) {
22:    const allChallenges = [...dailyChallenges.value, ...weeklyChallenges.value]
24:      const challenge = allChallenges.find(c => c.id === p.challengeId)
34:  function claimReward(challengeId: string): Challenge['reward'] | null {
38:    const allChallenges = [...dailyChallenges.value, ...weeklyChallenges.value]
39:    return allChallenges.find(c => c.id === challengeId)?.reward ?? null
42:  function getProgress(challengeId: string): ChallengeProgress | undefined {
47:    dailyChallenges,
48:    weeklyChallenges,
```

## Code Review

### Types (`types/challenge.ts`)
- `ChallengeCondition.type` union has 8 variants: `kill_monsters`, `crit_kills`, `combo_streak`, `damage_dealt`, `gold_earned`, `boss_kills`, `skills_used`, `floor_reached`
- `gold_earned` is defined in the type but **not used in any template**
- Types are clean and well-structured

### Generator (`challengeGenerator.ts`)
- `generateDailyChallenges()`: selects 3 random from 7 templates, assigns `daily_0/1/2` IDs
- `generateWeeklyChallenges()`: selects 5 random from 7 templates, assigns `weekly_0..4` IDs
- Uses index-based IDs (`daily_0`, `daily_1`, ...) — **potential issue**: if challenges regenerate (page refresh), new random challenges get different names/descriptions but same IDs, causing stale progress to show against mismatched challenge descriptions

### Store (`challengeStore.ts`)
- `initProgress()`: initializes all challenge progress to 0/false/false
- `updateProgress(type, value)`: iterates progress array, finds matching challenge by type, accumulates progress, marks completed when target reached
- `claimReward(challengeId)`: marks as claimed, returns reward object (does NOT auto-apply — UI layer applies gold/diamond via playerStore)
- `getProgress(challengeId)`: lookup helper

### UI (`ChallengePanel.vue`)
- Displays daily challenges section + weekly challenges section
- Shows name, description, progress text (current/target)
- Claim button appears when `completed && !claimed`
- Claim handler calls `challengeStore.claimReward()` then applies to `playerStore`
- **Missing**: `exp` reward application in `claim()` (only gold/diamond handled, exp ignored)
- Clean scoped CSS with proper layout

## Issues Found

### High
- **`exp` reward not applied in `Claim()`**: `ChallengePanel.vue` `claim()` handles `gold` and `diamond` but skips `exp`. Rewards of type `exp` are silently ignored.

### Medium
- **Index-based challenge IDs**: `daily_0`, `daily_1` etc. mean regenerating challenges (e.g., daily reset without persistence) will produce different challenge content with the same IDs, causing progress to display against wrong challenge descriptions.

### Low
- `gold_earned` condition type exists in union but is not used in any template
- No persistence layer — progress is in-memory only, lost on refresh

## Conclusion

**PARTIAL PASS** — Core system is functional and well-structured. The `exp` reward case is a silent bug (rewards not applied). The index-ID regeneration issue is a design risk for future daily resets. All other components are correctly implemented.

### Verdict Summary
| Check | Result |
|-------|--------|
| Types defined | PASS |
| generateDailyChallenges (3) | PASS |
| generateWeeklyChallenges (5) | PASS |
| initProgress / updateProgress / claimReward | PASS |
| ChallengePanel UI (daily + weekly) | PASS |
| Reward application completeness | **FAIL** (exp not applied) |
| ID stability for reset | PARTIAL |
