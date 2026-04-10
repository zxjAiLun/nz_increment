# Test Report — iter-25/pvp

## Summary

- **Test Files**: 19 passed
- **Tests**: 258 passed
- **Duration**: 3.87s
- **Result**: PASS

## Last 20 Lines (verbose output)

```
  ✓ src/utils/lifesteal.test.ts > calculateSkillLifesteal > null skill returns 0  2ms
  ✓ src/utils/lifesteal.test.ts > calculateSkillLifesteal > skill without lifesteal returns 0  0ms
  ✓ src/utils/lifesteal.test.ts > calculateSkillLifesteal > skill with 10% lifesteal on 1000 damage returns 100  0ms
  ✓ src/utils/lifesteal.test.ts > calculateSkillLifesteal > skill with 0 lifesteal returns 0  0ms
  ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: no multiplier returns 0  2ms
  ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > calculateSkillBaseDamage: multiplier × attack × hits  0ms
  ✓ src/composables/useSkillExecutor.test.ts > useSkillExecutor > executeSkillLogic: returns damage and cooldowns  0ms
  ✓ src/stores/gachaStore.test.ts > gacha pity > pity counter increments on pull  2ms
  ✓ src/stores/gachaStore.test.ts > gacha pity > pity resets after target  0ms
  ✓ src/stores/gachaStore.test.ts > gacha pity > soft pity activates after threshold  0ms
  ✓ src/utils/challenges.test.ts > daily challenges > challenge has required fields  2ms
  ✓ src/utils/challenges.test.ts > check-in rewards > 7 day cycle exists  0ms
  ✓ src/utils/equipmentCompare.test.ts > equipment compare > compareEquip shows differences correctly  2ms
  ✓ src/utils/skillSystemPassive.test.ts > passive effects > PassiveEffect interface is defined  2ms

  Test Files  19 passed (19)
       Tests  258 passed (258)
    Start at  16:33:32
    Duration  3.87s (transform 535ms, setup 0ms, import 1.13s, tests 230ms, environment 7ms)
```

## Conclusion

**PASS** — All 258 tests across 19 test files passed successfully on branch `iter-25/pvp`.
