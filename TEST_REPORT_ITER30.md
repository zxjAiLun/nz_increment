# Test Report — iter-30/final

**Date:** 2026-04-10 18:10 GMT+8  
**Branch:** iter-30/final  
**Command:** `npx vitest run --reporter=verbose`

## Result: PASS

### Summary

| Metric | Value |
|--------|-------|
| Test Files | 19 passed |
| Tests | 258 passed |
| Duration | 3.87s |

### Breakdown by File

- `src/utils/characterCultivation.test.ts` — all ASCENSION_BONUS phase tests passed
- `src/utils/moreFeatures.test.ts` — battle pass (30 levels), leaderboard sort & limit passed
- `src/composables/useSkillExecutor.test.ts` — calculateSkillBaseDamage & executeSkillLogic passed
- `src/stores/gachaStore.test.ts` — pity counter, pity reset, soft pity threshold passed
- `src/utils/challenges.test.ts` — daily challenges required fields, 7-day check-in cycle passed
- `src/utils/equipmentCompare.test.ts` — compareEquip differences passed
- `src/utils/skillSystemPassive.test.ts` — PassiveEffect interface passed

### Last 14 Lines of Output (tail)

```
 ✓ src/utils/characterCultivation.test.ts > ASCENSION_BONUS > phase 6 = 1.3  0ms
 ✓ src/utils/moreFeatures.test.ts > battle pass > battle pass has 30 levels  2ms
 ✓ src/utils/moreFeatures.test.ts > leaderboard > sorts by difficultyValue descending  0ms
 ✓ src/utils/moreFeatures.test.ts > leaderboard > limits to 100 entries  0ms
 ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: no multiplier returns 0  2ms
 ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: multiplier × attack × hits  0ms
 ✓ src/composables/useSkillExecutor.test.ts > executeSkillLogic > returns damage and cooldowns  0ms
 ✓ src/stores/gachaStore.test.ts > gacha pity > pity counter increments on pull  2ms
 ✓ src/stores/gachaStore.test.ts > gacha pity > pity resets after target  0ms
 ✓ src/stores/gachaStore.test.ts > gacha pity > soft pity activates after threshold  0ms
 ✓ src/utils/challenges.test.ts > daily challenges > challenge has required fields  2ms
 ✓ src/utils/challenges.test.ts > check-in rewards > 7 day cycle exists  0ms
 ✓ src/utils/equipmentCompare.test.ts > equipment compare > compareEquip shows differences correctly  2ms
 ✓ src/utils/skillSystemPassive.test.ts > passive effects > PassiveEffect interface is defined  2ms

 Test Files  19 passed (19)
      Tests  258 passed (258)
   Start at  18:11:06
   Duration  3.87s (transform 560ms, setup 0ms, import 1.13s, tests 226ms, environment 7ms)
```

## Conclusion

**PASS** — All 258 tests across 19 test files passed successfully.
