# Test Report - nz_increment Iteration 2 Final

**Date:** 2026-04-10 04:52 GMT+8
**Branch:** iter-2/combat-system
**Commit:** cfc099f (iter-2: fix critical bugs - remove per-tick gauge zeroing, integrate lifesteal)

---

## Summary

| Metric | Value |
|--------|-------|
| **Test Files** | 9 passed |
| **Tests** | 225 passed, 0 failed |
| **Status** | **PASS** |

---

## Background

Iteration 2 introduced a new speed-based initiative system for `startBattle()`:

- **Old behavior:** `playerActionGauge` was set to `GAUGE_MAX` (100) on battle start
- **New behavior:** Uses a speed-based offset formula:
  - If player speed >= monster speed: `offset = min((playerSpeed - monsterSpeed) * tickRate * 0.5, GAUGE_MAX * 0.5)`
  - If player speed < monster speed: offset goes to monster instead, player starts at 0

The previously failing test expected `playerActionGauge` to be 100 after `startBattle()`, which no longer matches the new speed-based initiative logic.

---

## Fix Applied

### 1. Updated Test: `startBattle 设置玩家行动槽为满（先手）`

**Location:** `src/stores/gameStore.test.ts`

**Changes:**
- Modified test to verify speed-based initiative behavior
- Sets player speed to 100 and monster speed to 10 to ensure player has speed advantage
- Expects `playerActionGauge = 50` (capped at `GAUGE_MAX * 0.5 = 50` due to formula)

```typescript
it('startBattle 设置玩家行动槽为满（先手）', async () => {
  // Set player speed > monster speed to test first-strike logic
  playerStore.player.stats.speed = 100
  playerStore.totalStats.speed = 100
  monsterStore.currentMonster.speed = 10

  gameStore.startBattle()

  // offset = min((100 - 10) * 10 * 0.5, 50) = 50
  expect(gameStore.playerActionGauge).toBe(50)
  expect(gameStore.monsterActionGauge).toBe(0)
})
```

### 2. Fixed Mock Architecture

**Issue:** The original mocks used factory functions `() => ({ ... })` which created **new objects** on each call to `usePlayerStore()` / `useMonsterStore()`. This meant modifications in tests were not visible to `startBattle()` internals.

**Fix:** Changed mocks to use **singleton instances** that return the same object reference:

```typescript
// Before (factory pattern - creates new object each call)
vi.mock('./playerStore', () => ({
  usePlayerStore: () => ({ ... })
}))

// After (singleton pattern - same reference)
const mockPlayerStore = { ... }
vi.mock('./playerStore', () => ({
  usePlayerStore: () => mockPlayerStore
}))
```

Also added mock speed reset in `beforeEach` to ensure test isolation:
```typescript
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockPlayerStore.player.stats.speed = 10
  mockPlayerStore.totalStats.speed = 10
  mockMonsterStore.currentMonster.speed = 10
})
```

---

## Test Results

```
 Test Files  9 passed (9)
      Tests  225 passed (225)
```

### Test Files:
- `src/stores/gameStore.test.ts` - 40 tests
- `src/stores/battleStore.test.ts` - 0 tests (file exists but may be empty or skipped)
- `src/utils/calc.test.ts` - 21 tests
- `src/utils/combo.test.ts` - 25 tests
- `src/utils/boundaries.test.ts` - 38 tests
- `src/utils/skillSystem.test.ts` - 28 tests
- `src/utils/equipmentGenerator.test.ts` - 25 tests
- `src/utils/monsterGenerator.test.ts` - 24 tests
- `src/utils/constants.test.ts` - 20 tests
- `src/utils/lifesteal.test.ts` - 4 tests

---

## Conclusion

**PASS** - All 225 tests pass after fixing the failing test to match the new speed-based initiative system implementation.
