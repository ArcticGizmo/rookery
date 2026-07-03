import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { buildStory } from '../../src/shared/story'

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
        ts: `2026-07-01T14:00:${String(id).padStart(2, '0')}.000Z`,
        type: type as StoredEvent['type'],
        actor: opts.actor ?? 'system',
        flightId: opts.flightId ?? 'f1',
        stageId: opts.stageId ?? null,
        payload
      })
      return this
    }
  }
}

describe('buildStory', () => {
  it('tells the flight as beats across the three lanes, oldest-first', () => {
    const l = log()
    l.add('flight.created', { flightId: 'f1', briefId: 'b1' }, { actor: 'human' })
    l.add('flight.started', { flightId: 'f1' })
    l.add('agent.spawned', { agentRunId: 'a1', personaName: 'Reviewer', model: 'opus' }, { actor: 'agent' })
    l.add(
      'flight.stage_output',
      { personaName: 'Reviewer', role: 'reviewer', artifact: '...' },
      { actor: 'agent' }
    )
    l.add('flight.checkpoint_awaiting', { description: 'Approve the plan' })
    l.add(
      'flight.checkpoint_resolved',
      { decision: 'approve', by: 'Jon', note: 'looks good' },
      { actor: 'human' }
    )
    l.add('flight.finished', { flightId: 'f1', status: 'passed' })

    const story = buildStory(l.events)
    expect(story.map((n) => n.lane)).toEqual([
      'you', // flight.created
      'system', // started
      'rooks', // spawned
      'rooks', // stage_output
      'system', // checkpoint_awaiting
      'you', // checkpoint_resolved
      'system' // finished
    ])
    // Oldest-first, timestamped, keyed by the source event id.
    expect(story[0]).toMatchObject({ id: 1, ts: l.events[0]!.ts })
    expect(story[0]!.title).toContain('Committed the brief to flight')
  })

  it('phrases a checkpoint decision by its verdict, carrying the note', () => {
    const l = log()
    l.add(
      'flight.checkpoint_resolved',
      { decision: 'request_changes', by: 'Jon', note: 'tighten the API' },
      { actor: 'human' }
    )
    const [node] = buildStory(l.events)
    expect(node).toMatchObject({ lane: 'you', actorLabel: 'you · checkpoint' })
    expect(node!.title).toContain('Requested changes')
    expect(node!.detail).toBe('tighten the API')
  })

  it('nests the granular agent stream under its beat for the zoom (J9.2)', () => {
    const l = log()
    l.add('agent.spawned', { agentRunId: 'a1', personaName: 'Dev', model: 'opus' }, { actor: 'agent' })
    l.add('agent.message', { agentRunId: 'a1', text: 'thinking…' }, { actor: 'agent' })
    l.add('agent.tool_use', { agentRunId: 'a1', toolName: 'Edit' }, { actor: 'agent' })
    l.add('agent.tool_result', { agentRunId: 'a1', isError: false, content: 'ok' }, { actor: 'agent' })
    l.add('flight.criterion_evaluated', { criterionType: 'tests_pass', passed: true, detail: '' })
    l.add('agent.finished', { agentRunId: 'a1' }, { actor: 'agent' })

    // Only the spawn is a broad-story beat; the chatter is nested beneath it,
    // not dropped and not promoted to top-level nodes.
    const story = buildStory(l.events)
    expect(story).toHaveLength(1)
    expect(story[0]!.type).toBe('agent.spawned')
    expect(story[0]!.children.map((c) => c.type)).toEqual([
      'agent.message',
      'agent.tool_use',
      'agent.tool_result',
      'flight.criterion_evaluated',
      'agent.finished'
    ])
  })

  it('carries each beat its raw payload, and drops chatter before the first beat', () => {
    const l = log()
    // A stray granular event before any beat has no parent — dropped entirely.
    l.add('agent.message', { agentRunId: 'a0', text: 'orphan' }, { actor: 'agent' })
    l.add('flight.started', { flightId: 'f1', extra: 'kept' })

    const story = buildStory(l.events)
    expect(story).toHaveLength(1)
    expect(story[0]).toMatchObject({ type: 'flight.started', children: [] })
    // The raw event payload is available for progressive disclosure (J9.2).
    expect(story[0]!.payload).toEqual({ flightId: 'f1', extra: 'kept' })
  })

  it('distinguishes an auto route-back from a human escalation', () => {
    const l = log()
    l.add('flight.verification_failed', { issues: 'flaky', routedBack: true, cycle: 1, maxCycles: 2 })
    l.add('flight.verification_failed', { issues: 'still red', routedBack: false, cycle: 2, maxCycles: 2 })
    const story = buildStory(l.events)
    expect(story[0]!.title).toContain('looping back')
    expect(story[1]!.title).toContain('escalated to you')
    expect(story.every((n) => n.actorLabel === 'verify')).toBe(true)
  })
})
