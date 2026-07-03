import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { briefsInFlight, needsYou } from '../../src/shared/attention'

/** Ordered event-log builder: ids/timestamps increase with insertion. */
function log() {
  let id = 0
  const events: StoredEvent[] = []
  return {
    events,
    add(
      type: string,
      payload: Record<string, unknown>,
      opts: { actor?: StoredEvent['actor']; runId?: string; stageId?: string } = {}
    ) {
      id += 1
      events.push({
        id,
        ts: `2026-07-01T00:00:${String(id).padStart(2, '0')}.000Z`,
        type: type as StoredEvent['type'],
        actor: opts.actor ?? 'system',
        runId: opts.runId ?? null,
        stageId: opts.stageId ?? null,
        payload
      })
      return this
    }
  }
}

describe('briefsInFlight', () => {
  it('lists non-terminal runs with their current stage and carries the work item', () => {
    const l = log()
    l.add('run.created', { runId: 'r1', briefId: 'w1' }, { runId: 'r1', actor: 'human' })
    l.add('run.started', { runId: 'r1' }, { runId: 'r1' })
    l.add('run.stage_entered', { stageName: 'Build' }, { runId: 'r1', stageId: 's1' })

    const flights = briefsInFlight(l.events)
    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({
      runId: 'r1',
      briefId: 'w1',
      status: 'running',
      currentStageName: 'Build',
      needsYou: false
    })
  })

  it('excludes finished, cancelled, and interrupted runs', () => {
    const l = log()
    l.add('run.started', { runId: 'done' }, { runId: 'done' })
    l.add('run.finished', { runId: 'done', status: 'passed' }, { runId: 'done' })
    l.add('run.started', { runId: 'gone' }, { runId: 'gone' })
    l.add('run.cancelled', { runId: 'gone', previousStatus: 'running' }, { runId: 'gone', actor: 'human' })
    l.add('run.started', { runId: 'live' }, { runId: 'live' })

    expect(briefsInFlight(l.events).map((f) => f.runId)).toEqual(['live'])
  })

  it('marks a run awaiting a human checkpoint as needsYou', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    l.add('run.stage_entered', { stageName: 'Review' }, { runId: 'r' })
    l.add('run.checkpoint_awaiting', { checkpointId: 'g', description: 'Approve the reviewed brief' }, { runId: 'r' })

    const [flight] = briefsInFlight(l.events)
    expect(flight).toMatchObject({ status: 'awaiting_checkpoint', needsYou: true })
  })

  it('sorts most-recently-active first', () => {
    const l = log()
    l.add('run.started', { runId: 'old' }, { runId: 'old' })
    l.add('run.started', { runId: 'new' }, { runId: 'new' })
    l.add('run.stage_entered', { stageName: 'X' }, { runId: 'old' }) // old becomes most recent

    expect(briefsInFlight(l.events).map((f) => f.runId)).toEqual(['old', 'new'])
  })
})

describe('needsYou', () => {
  it('surfaces a held checkpoint with its stage and description', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    l.add('run.stage_entered', { stageName: 'Plan' }, { runId: 'r' })
    l.add('run.checkpoint_awaiting', { checkpointId: 'g', description: 'Approve the plan' }, { runId: 'r' })

    const items = needsYou(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      runId: 'r',
      kind: 'checkpoint',
      title: 'Checkpoint · Plan',
      detail: 'Approve the plan'
    })
  })

  it('clears a checkpoint once resolved', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    l.add('run.checkpoint_awaiting', { checkpointId: 'g', description: 'Sign off' }, { runId: 'r' })
    l.add('run.checkpoint_resolved', { decision: 'approve', by: 'me', note: '' }, { runId: 'r', actor: 'human' })
    l.add('run.stage_entered', { stageName: 'Build' }, { runId: 'r' })

    expect(needsYou(l.events)).toHaveLength(0)
    expect(briefsInFlight(l.events)[0].needsYou).toBe(false)
  })

  it('escalates a verification failure only when the route-back budget is spent', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    // Auto route-back — handled without the human.
    l.add('run.verification_failed', { issues: 'flaky', routedBack: true, cycle: 1, maxCycles: 2 }, { runId: 'r' })
    expect(needsYou(l.events)).toHaveLength(0)
    // Budget spent — now it needs a human.
    l.add('run.verification_failed', { issues: 'tests still red', routedBack: false, cycle: 2, maxCycles: 2 }, { runId: 'r' })
    const items = needsYou(l.events)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'verification', detail: 'tests still red' })
  })

  it('flags an active agent at high context pressure, but not once it finishes', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    l.add('agent.spawned', { agentRunId: 'a', personaName: 'Dev', model: 'm' }, { runId: 'r', actor: 'agent' })
    l.add('agent.context_pressure', { agentRunId: 'a', percent: 93, level: 'high' }, { runId: 'r', actor: 'agent' })
    expect(needsYou(l.events).filter((i) => i.kind === 'pressure')).toHaveLength(1)

    l.add('agent.finished', { agentRunId: 'a' }, { runId: 'r', actor: 'agent' })
    expect(needsYou(l.events).filter((i) => i.kind === 'pressure')).toHaveLength(0)
  })

  it('ignores attention for terminal runs', () => {
    const l = log()
    l.add('run.started', { runId: 'r' }, { runId: 'r' })
    l.add('run.checkpoint_awaiting', { checkpointId: 'g', description: 'x' }, { runId: 'r' })
    l.add('run.finished', { runId: 'r', status: 'cancelled' }, { runId: 'r' })
    expect(needsYou(l.events)).toHaveLength(0)
  })
})
