import { beforeEach, describe, expect, it } from 'vitest'
import type { EventActor } from '../../src/shared/events'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import type { NewEvent } from '../../src/main/services/event-store'

function ev(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    ts: '2026-07-02T00:00:00.000Z',
    type: 'app.booted',
    actor: 'system' as EventActor,
    runId: null,
    stageId: null,
    payload: {},
    ...overrides
  }
}

describe('event store filtering (ListEventsOptions)', () => {
  let store: InMemoryEventStore

  beforeEach(async () => {
    store = new InMemoryEventStore()
    await store.insert(ev({ type: 'app.booted', actor: 'system', ts: '2026-07-01T10:00:00.000Z' }))
    await store.insert(
      ev({ type: 'run.started', actor: 'system', runId: 'r1', ts: '2026-07-01T11:00:00.000Z' })
    )
    await store.insert(
      ev({
        type: 'agent.tool_use',
        actor: 'agent',
        runId: 'r1',
        stageId: 's1',
        payload: { toolName: 'Bash' },
        ts: '2026-07-01T12:00:00.000Z'
      })
    )
    await store.insert(
      ev({ type: 'agent.finished', actor: 'agent', runId: 'r2', ts: '2026-07-01T13:00:00.000Z' })
    )
  })

  it('filters by actor', async () => {
    const rows = await store.list({ actor: 'agent' })
    expect(rows.map((r) => r.type)).toEqual(['agent.tool_use', 'agent.finished'])
  })

  it('filters by type prefix', async () => {
    expect((await store.list({ type: 'agent.' })).length).toBe(2)
    expect((await store.list({ type: 'agent.tool_use' })).map((r) => r.type)).toEqual([
      'agent.tool_use'
    ])
    expect((await store.list({ type: 'run.' })).length).toBe(1)
  })

  it('filters by runId and stageId', async () => {
    expect((await store.list({ runId: 'r1' })).length).toBe(2)
    expect((await store.list({ stageId: 's1' })).map((r) => r.type)).toEqual(['agent.tool_use'])
  })

  it('filters by time range (inclusive)', async () => {
    const rows = await store.list({
      since: '2026-07-01T11:00:00.000Z',
      until: '2026-07-01T12:00:00.000Z'
    })
    expect(rows.map((r) => r.type)).toEqual(['run.started', 'agent.tool_use'])
  })

  it('searches type and serialized payload (case-insensitive)', async () => {
    expect((await store.list({ search: 'bash' })).map((r) => r.type)).toEqual(['agent.tool_use'])
    expect((await store.list({ search: 'BOOTED' })).map((r) => r.type)).toEqual(['app.booted'])
  })

  it('orders descending and pages with beforeId', async () => {
    const desc = await store.list({ order: 'desc' })
    expect(desc.map((r) => r.id)).toEqual([4, 3, 2, 1])
    const page = await store.list({ order: 'desc', beforeId: 3 })
    expect(page.map((r) => r.id)).toEqual([2, 1])
  })

  it('respects limit and afterId (incremental sync unchanged)', async () => {
    expect((await store.list({ limit: 2 })).map((r) => r.id)).toEqual([1, 2])
    expect((await store.list({ afterId: 2 })).map((r) => r.id)).toEqual([3, 4])
  })

  it('combines filters with AND semantics', async () => {
    const rows = await store.list({ actor: 'agent', runId: 'r1' })
    expect(rows.map((r) => r.type)).toEqual(['agent.tool_use'])
  })
})
