import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from './petStore'
import { useFriendStore } from './friendStore'
import { useGuildStore } from './guildStore'

describe('T67 - Pet Social System', () => {

  describe('Pet passive skill integration', () => {
    it('capturePet adds pet to ownedPets', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      const result = pet.capturePet('pet_fire_sprite')
      expect(result).toBe(true)
      expect(pet.ownedPets.some(p => p.id === 'pet_fire_sprite')).toBe(true)
    })

    it('capturePet returns false for already owned pet', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      pet.capturePet('pet_fire_sprite')
      const result = pet.capturePet('pet_fire_sprite')
      expect(result).toBe(false)
    })

    it('equipPet sets equippedPet', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      pet.capturePet('pet_fire_sprite')
      const result = pet.equipPet('pet_fire_sprite')
      expect(result).toBe(true)
      expect(pet.equippedPet?.id).toBe('pet_fire_sprite')
    })

    it('getStats returns scaled stats based on stage', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      pet.capturePet('pet_earth_wolf')
      pet.equipPet('pet_earth_wolf')
      const stats = pet.getStats(pet.equippedPet!)
      expect(stats.attack).toBeGreaterThan(0)
      expect(stats.defense).toBeGreaterThan(0)
      expect(stats.maxHp).toBeGreaterThan(0)
      expect(stats.speed).toBeGreaterThan(0)
    })

    it('evolvePet increases stage and scales stats', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      pet.capturePet('pet_earth_wolf')
      pet.equipPet('pet_earth_wolf')
      const statsBefore = pet.getStats(pet.equippedPet!)
      pet.evolvePet('pet_earth_wolf')
      const statsAfter = pet.getStats(pet.equippedPet!)
      expect(statsAfter.attack).toBeGreaterThan(statsBefore.attack)
      expect(pet.equippedPet!.currentStage).toBe(2)
    })

    it('unequipPet clears equippedPet', () => {
      setActivePinia(createPinia())
      const pet = usePetStore()
      pet.capturePet('pet_fire_sprite')
      pet.equipPet('pet_fire_sprite')
      pet.unequipPet()
      expect(pet.equippedPet).toBeNull()
    })
  })

  describe('Friend gold gift system', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })

    it('canSendGift returns true for new friend', () => {
      const friend = useFriendStore()
      const result = friend.canSendGift('f1')
      expect(result).toBe(true)
    })

    it('sendGoldGift deducts gold and returns true', () => {
      const friend = useFriendStore()
      let playerGold = 5000
      const deductFn = (amount: number) => {
        if (playerGold < amount) return false
        playerGold -= amount
        return true
      }
      // First add friend so sendGoldGift passes check
      friend.friends.push({ id: 'f_new', name: 'TestFriend', level: 50, status: 'online', lastActive: Date.now() })
      const result = friend.sendGoldGift('f_new', deductFn)
      expect(result).toBe(true)
      expect(playerGold).toBe(4000) // 5000 - 1000
    })

    it('sendGoldGift returns false if insufficient gold', () => {
      const friend = useFriendStore()
      let playerGold = 500
      const deductFn = (amount: number) => {
        if (playerGold < amount) return false
        playerGold -= amount
        return true
      }
      friend.friends.push({ id: 'f_new2', name: 'TestFriend2', level: 50, status: 'online', lastActive: Date.now() })
      const result = friend.sendGoldGift('f_new2', deductFn)
      expect(result).toBe(false)
    })

    it('canSendGift returns false after sending gift same day', () => {
      const friend = useFriendStore()
      let playerGold = 5000
      friend.friends.push({ id: 'f_daily', name: 'Daily', level: 50, status: 'online', lastActive: Date.now() })
      friend.sendGoldGift('f_daily', (amount) => { playerGold -= amount; return true })
      expect(friend.canSendGift('f_daily')).toBe(false)
    })
  })

  describe('Guild sign-in system', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })

    it('canSignIn returns false when no guild', () => {
      const guild = useGuildStore()
      expect(guild.canSignIn()).toBe(false)
    })

    it('signIn returns 0 when no guild', () => {
      const guild = useGuildStore()
      expect(guild.signIn()).toBe(0)
    })

    it('signInRecord starts at 0 streak', () => {
      const guild = useGuildStore()
      expect(guild.signInRecord?.streak).toBe(0)
    })
  })
})
