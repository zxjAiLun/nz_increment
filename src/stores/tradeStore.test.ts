import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTradeStore } from './tradeStore'

describe('tradeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('createTradeRequest creates a pending request', () => {
    const store = useTradeStore()
    const req = store.createTradeRequest('player1', 'Alice', 'player2', [], 1000)
    expect(req.status).toBe('pending')
    expect(req.fromId).toBe('player1')
    expect(req.toId).toBe('player2')
    expect(req.gold).toBe(1000)
    expect(req.expiresAt).toBeGreaterThan(Date.now())
  })

  it('acceptTrade sets status to accepted and activates trade', () => {
    const store = useTradeStore()
    const req = store.createTradeRequest('player1', 'Alice', 'player2', [], 1000)
    const accepted = store.acceptTrade(req.id, [], 500)
    expect(accepted).toBe(true)
    expect(req.status).toBe('accepted')
    expect(store.activeTrade).not.toBeNull()
    expect(store.activeTrade?.request.id).toBe(req.id)
  })

  it('rejectTrade sets status to rejected', () => {
    const store = useTradeStore()
    const req = store.createTradeRequest('player1', 'Alice', 'player2', [], 1000)
    store.rejectTrade(req.id)
    expect(req.status).toBe('rejected')
  })

  it('completeTrade adds to history and clears activeTrade', () => {
    const store = useTradeStore()
    const req = store.createTradeRequest('player1', 'Alice', 'player2', [], 1000)
    store.acceptTrade(req.id, [], 500)
    const history = store.completeTrade(req.id)
    expect(history).not.toBeNull()
    expect(history!.gold).toBe(1500)
    expect(req.status).toBe('completed')
    expect(store.activeTrade).toBeNull()
  })

  it('getIncomingForPlayer filters correctly', () => {
    const store = useTradeStore()
    store.createTradeRequest('p1', 'A', 'player2', [], 100)
    store.createTradeRequest('p2', 'B', 'player2', [], 200)
    store.createTradeRequest('p3', 'C', 'player3', [], 300)
    const incoming = store.getIncomingForPlayer('player2')
    expect(incoming).toHaveLength(2)
  })

  it('cleanupExpired removes expired pending requests', () => {
    const store = useTradeStore()
    // Manually set an expired request
    store.outgoingRequests.push({
      id: 'expired_req',
      fromId: 'p1',
      fromName: 'A',
      toId: 'p2',
      items: [],
      gold: 100,
      status: 'pending',
      createdAt: Date.now() - 86400000 * 2,
      expiresAt: Date.now() - 86400000, // expired
    })
    store.cleanupExpired()
    const found = store.outgoingRequests.find(r => r.id === 'expired_req')
    expect(found).toBeUndefined()
  })
})
