import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { computeNotifications } from '../../src/shared/notifications'

/** Ordered event-log builder: ids/timestamps increase with insertion. */
function log() {
  let id = 0
  const events: StoredEvent[] = []
  return {
    events,
    add(
      type: string,
      payload: Record<string, unknown>,
      opts: { actor?: StoredEvent['actor']; flightId?: string; stageId?: string } = {}
    ) {
      id += 1
      events.push({
        id,
        ts: `2026-07-01T00:00:${String(id).padStart(2, '0')}.000Z`,
        type: type as StoredEvent['type'],
        actor: opts.actor ?? 'system',
        flightId: opts.flightId ?? null,
        stageId: opts.stageId ?? null,
        payload
      })
      return this
    }
  }
}

describe('computeNotifications', () => {
  it('surfaces a notification for each human checkpoint awaiting', () => {
    const l = log()
    l.add('flight.checkpoint_awaiting', { description: 'Approve the review' }, { flightId: 'r1' })

    const items = computeNotifications(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 1,
      kind: 'checkpoint',
      flightId: 'r1',
      title: 'Human checkpoint awaiting',
      body: 'Approve the review'
    })
  })

  it('notifies only on the rising edge into high context pressure', () => {
    const l = log()
    const agent = { agentRunId: 'a1', actor: 'agent' as const, flightId: 'r1' }
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 75, level: 'warn' }, agent)
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 92, level: 'high' }, agent) // ← edge
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 95, level: 'high' }, agent) // sustained: no repeat

    const items = computeNotifications(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 2, kind: 'pressure', flightId: 'r1' })
    expect(items[0]!.body).toContain('92%')
  })

  it('re-arms after pressure drops below high', () => {
    const l = log()
    const agent = { agentRunId: 'a1', actor: 'agent' as const, flightId: 'r1' }
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 92, level: 'high' }, agent)
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 60, level: 'ok' }, agent)
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 91, level: 'high' }, agent)

    expect(computeNotifications(l.events).map((n) => n.id)).toEqual([1, 3])
  })

  it('tracks pressure per agent independently', () => {
    const l = log()
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 91, level: 'high' }, { actor: 'agent', flightId: 'r1' })
    l.add('agent.context_pressure', { agentRunId: 'a2', percent: 93, level: 'high' }, { actor: 'agent', flightId: 'r1' })

    const items = computeNotifications(l.events)
    expect(items).toHaveLength(2)
    expect(items.every((n) => n.kind === 'pressure')).toBe(true)
  })

  it('surfaces a downloaded update as an actionable notification', () => {
    const l = log()
    l.add('app.update_downloaded', { version: '1.2.3' })

    const items = computeNotifications(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 1, kind: 'update', flightId: null, title: 'Update ready' })
    expect(items[0]!.body).toContain('1.2.3')
  })

  it('ignores an available-but-not-downloaded update (not yet actionable)', () => {
    const l = log()
    l.add('app.update_available', { version: '1.2.3' })
    expect(computeNotifications(l.events)).toHaveLength(0)
  })

  it('ignores unrelated events and preserves chronological order', () => {
    const l = log()
    l.add('app.booted', { version: '0', platform: 'win32' })
    l.add('flight.checkpoint_awaiting', { description: 'checkpoint A' }, { flightId: 'r1' })
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 95, level: 'high' }, { actor: 'agent', flightId: 'r2' })
    l.add('flight.finished', { flightId: 'r1', status: 'passed' }, { flightId: 'r1' })

    const items = computeNotifications(l.events)
    expect(items.map((n) => n.kind)).toEqual(['checkpoint', 'pressure'])
    expect(items.map((n) => n.id)).toEqual([2, 3])
  })
})
