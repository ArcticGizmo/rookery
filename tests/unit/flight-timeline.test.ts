import { describe, expect, it } from 'vitest'
import { eventsByStage, rightNow } from '../../src/shared/flight-timeline'
import type { StoredEvent } from '../../src/shared/events'

let seq = 0
function ev(
  type: string,
  payload: Record<string, unknown> = {},
  stageId: string | null = null
): StoredEvent {
  seq += 1
  return {
    id: seq,
    ts: `2026-07-02T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type: type as StoredEvent['type'],
    actor: 'agent',
    flightId: 'r1',
    stageId,
    payload
  }
}

describe('eventsByStage', () => {
  it('attributes events to the most recently entered stage, including flight-scoped agent events', () => {
    const events = [
      ev('flight.created'),
      ev('flight.stage_entered', { stageId: 's1', stageName: 'Review' }, 's1'),
      ev('agent.message', { text: 'reviewing' }), // stageId null — still belongs to s1
      ev('flight.stage_entered', { stageId: 's2', stageName: 'Plan' }, 's2'),
      ev('agent.tool_use', { toolName: 'Read' })
    ]
    const byStage = eventsByStage(events)
    expect(byStage.get('s1')?.map((e) => e.type)).toEqual(['flight.stage_entered', 'agent.message'])
    expect(byStage.get('s2')?.map((e) => e.type)).toEqual(['flight.stage_entered', 'agent.tool_use'])
  })

  it('drops events before the first stage was entered', () => {
    const byStage = eventsByStage([ev('flight.created'), ev('flight.started')])
    expect(byStage.size).toBe(0)
  })

  it('appends to the same slice when a stage is re-entered (iterations / route-backs)', () => {
    const events = [
      ev('flight.stage_entered', { stageId: 's1' }, 's1'),
      ev('agent.message', { text: 'try 1' }),
      ev('flight.stage_entered', { stageId: 's2' }, 's2'),
      ev('flight.stage_entered', { stageId: 's1' }, 's1'), // routed back
      ev('agent.message', { text: 'try 2' })
    ]
    // Both stage_entered markers for s1 plus both messages land in one slice.
    const s1 = eventsByStage(events).get('s1')
    expect(s1).toHaveLength(4)
    expect(s1?.map((e) => e.type)).toEqual([
      'flight.stage_entered',
      'agent.message',
      'flight.stage_entered',
      'agent.message'
    ])
    expect(s1?.at(-1)?.payload).toMatchObject({ text: 'try 2' })
  })
})

describe('rightNow', () => {
  it('lists agents that are spawned but not yet finished', () => {
    const events = [
      ev('agent.spawned', { agentRunId: 'a1', personaName: 'Engineer', model: 'opus' }),
      ev('agent.spawned', { agentRunId: 'a2', personaName: 'Reviewer', model: 'sonnet' }),
      ev('agent.finished', { agentRunId: 'a1' })
    ]
    const snapshot = rightNow(events)
    expect(snapshot.agents.map((a) => a.personaName)).toEqual(['Reviewer'])
  })

  it('drops agents on error and cancellation too', () => {
    const events = [
      ev('agent.spawned', { agentRunId: 'a1', personaName: 'A', model: 'm' }),
      ev('agent.spawned', { agentRunId: 'a2', personaName: 'B', model: 'm' }),
      ev('agent.error', { agentRunId: 'a1', message: 'boom' }),
      ev('agent.cancelled', { agentRunId: 'a2' })
    ]
    expect(rightNow(events).agents).toEqual([])
  })

  it('reports the latest context-pressure reading and band', () => {
    const events = [
      ev('agent.context_pressure', { agentRunId: 'a1', percent: 30, level: 'ok' }),
      ev('agent.context_pressure', { agentRunId: 'a1', percent: 88, level: 'high' })
    ]
    expect(rightNow(events).pressure).toEqual({ percent: 88, level: 'high' })
  })

  it('has no pressure reading before any is emitted', () => {
    expect(rightNow([ev('agent.spawned', { agentRunId: 'a', personaName: 'A', model: 'm' })]).pressure).toBeNull()
  })
})
