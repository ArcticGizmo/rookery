import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'

function makeLog(): AuditLog {
  return new AuditLog(new InMemoryEventStore())
}

describe('AuditLog', () => {
  let log: AuditLog

  beforeEach(() => {
    log = makeLog()
  })

  it('assigns a monotonic id and an ISO timestamp on append', async () => {
    const a = await log.append({ type: 'app.booted', actor: 'system', payload: { version: '0', platform: 'test' } })
    const b = await log.append({ type: 'app.shutdown', actor: 'system', payload: {} })

    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
    expect(a.actor).toBe('system')
    expect(() => new Date(a.ts).toISOString()).not.toThrow()
    expect(new Date(a.ts).toISOString()).toBe(a.ts)
  })

  it('lists events in ascending id order', async () => {
    await log.append({ type: 'app.booted', actor: 'system', payload: { version: '0', platform: 'test' } })
    await log.append({ type: 'app.shutdown', actor: 'system', payload: {} })

    const events = await log.list()
    expect(events.map((e) => e.id)).toEqual([1, 2])
    expect(events.map((e) => e.type)).toEqual(['app.booted', 'app.shutdown'])
  })

  it('supports incremental reads via afterId', async () => {
    await log.append({ type: 'app.booted', actor: 'system', payload: { version: '0', platform: 'test' } })
    const second = await log.append({ type: 'app.shutdown', actor: 'system', payload: {} })

    const after = await log.list({ afterId: 1 })
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(second.id)
  })

  it('respects the limit option', async () => {
    for (let i = 0; i < 5; i++) {
      await log.append({ type: 'app.shutdown', actor: 'system', payload: {} })
    }
    const limited = await log.list({ limit: 2 })
    expect(limited).toHaveLength(2)
  })

  it('notifies subscribers on append and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const unsubscribe = log.onAppend(listener)

    await log.append({ type: 'app.booted', actor: 'system', payload: { version: '0', platform: 'test' } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({ id: 1, type: 'app.booted' })

    unsubscribe()
    await log.append({ type: 'app.shutdown', actor: 'system', payload: {} })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns copies so stored events cannot be mutated by callers', async () => {
    await log.append({ type: 'app.booted', actor: 'system', payload: { version: '0', platform: 'test' } })
    const first = await log.list()
    first[0].type = 'app.shutdown'

    const again = await log.list()
    expect(again[0].type).toBe('app.booted')
  })
})
