# Test Report — iter-26/roguelike

## Summary

- **Test Files**: 19 passed
- **Total Tests**: 258 passed
- **Duration**: 3.88s
- **Conclusion**: **PASS**

## Output (last 20 lines)

```
 ✓ src/utils/characterCultivation.test.ts > STAR_MULTIPLIERS > star 1 = 1.0  2ms
 ✓ src/utils/characterCultivation.test.ts > STAR_MULTIPLIERS > star 6 = 1.8  0ms
 ✓ src/utils/characterCultivation.test.ts > ASCENSION_BONUS > phase 0 = 1.0  0ms
 ✓ src/utils/characterCultivation.test.ts > ASCENSION_BONUS > phase 6 = 1.3  0ms
 ✓ src/utils/moreFeatures.test.ts > battle pass > battle pass has 30 levels  2ms
 ✓ src/utils/moreFeatures.test.ts > leaderboard > sorts by difficultyValue descending  0ms
 ✓ src/utils/moreFeatures.test.ts > leaderboard > limits to 100 entries  0ms
 ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: no multiplier returns 0  2ms
 ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: multiplier × attack × hits  0ms
 ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > executeSkillLogic: returns damage and cooldowns  0ms
 ✓ src/utils/challenges.test.ts > daily challenges > challenge has required fields  2ms
 ✓ src/utils/challenges.test.ts > check-in rewards > 7 day cycle exists  0ms
 ✓ src/utils/equipmentCompare.test.ts > equipment compare > compareEquip shows differences correctly  2ms
 ✓ src/utils/skillSystemPassive.test.ts > passive effects > PassiveEffect interface is defined  2ms

 Test Files  19 passed (19)
      Tests  258 passed (258)
   Start at  16:37:36
   Duration  3.88s (transform 588ms, setup 0ms, import 1.16s, tests 220ms, environment 7ms)
```

## Result

**PASS** — All 258 tests across 19 test files pass. No failures.
