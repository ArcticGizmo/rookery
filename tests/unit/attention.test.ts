import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { briefsInFlight, isDecision, needsYou } from '../../src/shared/attention'

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

describe('briefsInFlight', () => {
  it('lists non-terminal flights with their current stage and carries the work item', () => {
    const l = log()
    l.add('flight.created', { flightId: 'r1', briefId: 'w1' }, { flightId: 'r1', actor: 'human' })
    l.add('flight.started', { flightId: 'r1' }, { flightId: 'r1' })
    l.add('flight.stage_entered', { stageName: 'Build' }, { flightId: 'r1', stageId: 's1' })

    const flights = briefsInFlight(l.events)
    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({
      flightId: 'r1',
      briefId: 'w1',
      status: 'running',
      currentStageName: 'Build',
      needsYou: false
    })
  })

  it('excludes finished, cancelled, and interrupted flights', () => {
    const l = log()
    l.add('flight.started', { flightId: 'done' }, { flightId: 'done' })
    l.add('flight.finished', { flightId: 'done', status: 'passed' }, { flightId: 'done' })
    l.add('flight.started', { flightId: 'gone' }, { flightId: 'gone' })
    l.add('flight.cancelled', { flightId: 'gone', previousStatus: 'running' }, { flightId: 'gone', actor: 'human' })
    l.add('flight.started', { flightId: 'live' }, { flightId: 'live' })

    expect(briefsInFlight(l.events).map((f) => f.flightId)).toEqual(['live'])
  })

  it('marks a run awaiting a human checkpoint as needsYou', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    l.add('flight.stage_entered', { stageName: 'Review' }, { flightId: 'r' })
    l.add('flight.checkpoint_awaiting', { checkpointId: 'g', description: 'Approve the reviewed brief' }, { flightId: 'r' })

    const [flight] = briefsInFlight(l.events)
    expect(flight).toMatchObject({ status: 'awaiting_checkpoint', needsYou: true })
  })

  it('keeps a held flight in flight while others keep flying (J8.5)', () => {
    // The patience guarantee, at the projection level: a flight paused on a
    // checkpoint stays listed (it hasn't ended — it waits indefinitely), and a
    // sibling flight keeps flying alongside it, unaffected.
    const l = log()
    l.add('flight.started', { flightId: 'held' }, { flightId: 'held' })
    l.add('flight.stage_entered', { stageName: 'Review' }, { flightId: 'held' })
    l.add('flight.checkpoint_awaiting', { checkpointId: 'g', description: 'Approve' }, { flightId: 'held' })
    l.add('flight.started', { flightId: 'flying' }, { flightId: 'flying' })
    l.add('flight.stage_entered', { stageName: 'Build' }, { flightId: 'flying' })

    const flights = briefsInFlight(l.events)
    const held = flights.find((f) => f.flightId === 'held')
    const flying = flights.find((f) => f.flightId === 'flying')
    expect(held).toMatchObject({ status: 'awaiting_checkpoint', needsYou: true })
    expect(flying).toMatchObject({ status: 'running', needsYou: false })
  })

  it('sorts most-recently-active first', () => {
    const l = log()
    l.add('flight.started', { flightId: 'old' }, { flightId: 'old' })
    l.add('flight.started', { flightId: 'new' }, { flightId: 'new' })
    l.add('flight.stage_entered', { stageName: 'X' }, { flightId: 'old' }) // old becomes most recent

    expect(briefsInFlight(l.events).map((f) => f.flightId)).toEqual(['old', 'new'])
  })
})

describe('needsYou', () => {
  it('surfaces a held checkpoint with its stage and description', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    l.add('flight.stage_entered', { stageName: 'Plan' }, { flightId: 'r' })
    l.add('flight.checkpoint_awaiting', { checkpointId: 'g', description: 'Approve the plan' }, { flightId: 'r' })

    const items = needsYou(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      flightId: 'r',
      kind: 'checkpoint',
      title: 'Checkpoint · Plan',
      detail: 'Approve the plan'
    })
  })

  it('clears a checkpoint once resolved', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    l.add('flight.checkpoint_awaiting', { checkpointId: 'g', description: 'Sign off' }, { flightId: 'r' })
    l.add('flight.checkpoint_resolved', { decision: 'approve', by: 'me', note: '' }, { flightId: 'r', actor: 'human' })
    l.add('flight.stage_entered', { stageName: 'Build' }, { flightId: 'r' })

    expect(needsYou(l.events)).toHaveLength(0)
    expect(briefsInFlight(l.events)[0].needsYou).toBe(false)
  })

  it('escalates a verification failure only when the route-back budget is spent', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    // Auto route-back — handled without the human.
    l.add('flight.verification_failed', { issues: 'flaky', routedBack: true, cycle: 1, maxCycles: 2 }, { flightId: 'r' })
    expect(needsYou(l.events)).toHaveLength(0)
    // Budget spent — now it needs a human.
    l.add('flight.verification_failed', { issues: 'tests still red', routedBack: false, cycle: 2, maxCycles: 2 }, { flightId: 'r' })
    const items = needsYou(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'verification', detail: 'tests still red' })
  })

  it('flags an active agent at high context pressure, but not once it finishes', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    l.add('agent.spawned', { agentRunId: 'a', personaName: 'Dev', model: 'm' }, { flightId: 'r', actor: 'agent' })
    l.add('agent.context_pressure', { agentRunId: 'a', percent: 93, level: 'high' }, { flightId: 'r', actor: 'agent' })
    expect(needsYou(l.events).filter((i) => i.kind === 'pressure')).toHaveLength(1)

    l.add('agent.finished', { agentRunId: 'a' }, { flightId: 'r', actor: 'agent' })
    expect(needsYou(l.events).filter((i) => i.kind === 'pressure')).toHaveLength(0)
  })

  it('ignores attention for terminal flights', () => {
    const l = log()
    l.add('flight.started', { flightId: 'r' }, { flightId: 'r' })
    l.add('flight.checkpoint_awaiting', { checkpointId: 'g', description: 'x' }, { flightId: 'r' })
    l.add('flight.finished', { flightId: 'r', status: 'cancelled' }, { flightId: 'r' })
    expect(needsYou(l.events)).toHaveLength(0)
  })
})

describe('isDecision', () => {
  it('treats checkpoints and verification escalations as decisions, pressure as a warning', () => {
    expect(isDecision('checkpoint')).toBe(true)
    expect(isDecision('verification')).toBe(true)
    expect(isDecision('pressure')).toBe(false)
  })
})
