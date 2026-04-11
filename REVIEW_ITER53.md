# Review: iter-53 pet-system (commit 1bdaad1)

## Verification

```
$ grep -n "usePetStore\|PETS\|evolvePet" src/ --include="*.ts" -r | head -10
src/data/pets.ts:11:export const PETS: Pet[] = [
src/stores/petStore.ts:4:import { PETS } from '../data/pets'
src/stores/petStore.ts:6:export const usePetStore = defineStore('pet', () => {
src/stores/petStore.ts:11:    const petData = PETS.find(p => p.id === petId)
src/stores/petStore.ts:30:  function evolvePet(petId: string): boolean {
src/stores/petStore.ts:53:  return { ownedPets, equippedPet, capturePet, equipPet, unequipPet, evolvePet, getStats }
```

**PASS** - all required symbols present and correctly exported.

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| `src/data/pets.ts` | +23 | Pet interface, PETS array (4 pets), PET_SKILLS |
| `src/stores/petStore.ts` | +54 | Pinia store: capture/equip/unequip/evolve/getStats |
| `src/components/PetTab.vue` | +89 | Full UI: equipped, owned, capture, evolve |
| `REVIEW_ITER52.md` | +42 | (carried over from prior iteration) |

## Implementation Review

### Pet Data (`pets.ts`)
- 4 pets: fire_sprite (rare), ice_golem (epic), thunder_bird (legend), earth_wolf (common)
- `evolutionStages`: thunder_bird has 3 stages, others have 2
- Skills defined per pet (fireball, ice_shield, thunder, earth_bite)
- TypeScript interface properly typed

### Pet Store (`petStore.ts`)
- `capturePet` - idempotent guard: returns false if already owned
- `equipPet` / `unequipPet` - single equipped slot
- `evolvePet` - guards against max stage reached; 1.3x stat multiplier on evolution
- `getStats` - applies currentStage multiplier (1 + (stage-1)*0.3) to base stats

### PetTab UI (`PetTab.vue`)
- Shows equipped pet with stats and unequip button
- Lists owned pets with equip/evolve actions (conditional)
- Capture section shows uncaptured pets
- Rarity color coding (legend=gold, epic=purple, rare=blue, common=gray)
- `PET_SKILLS` cast to `any` for dynamic skill lookup — minor type looseness, no runtime risk

## Minor Observations
- `(PET_SKILLS as any)[p.skillId]` — could be typed properly with a `skillId` keyof PET_SKILLS map, but functional
- `evolvePet` mutates in-place (acceptable for Pinia ref)
- No persistence layer (localStorage/etc.) — expected to be added in future iteration

## Conclusion

**PASS**

Clean, complete iteration. Core pet system (capture/equip/evolve/stats) fully implemented with 4 pets across 3 rarity tiers. UI is functional and well-structured. No obvious bugs or gaps.
