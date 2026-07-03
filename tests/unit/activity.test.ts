import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { computeActivity } from '../../src/shared/activity'

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

describe('computeActivity', () => {
  it('surfaces active runs and agents with context pressure', () => {
    const l = log()
    l.add('run.started', { runId: 'r1' }, { runId: 'r1' })
    l.add('run.stage_entered', { stageName: 'Implement' }, { runId: 'r1', stageId: 's1' })
    l.add('agent.spawned', { agentRunId: 'a1', personaName: 'Dev', model: 'claude-opus-4-8' }, { runId: 'r1', stageId: 's1', actor: 'agent' })
    l.add('agent.tool_use', { agentRunId: 'a1', toolName: 'Bash' }, { runId: 'r1', actor: 'agent' })
    l.add('agent.context_pressure', { agentRunId: 'a1', percent: 75 }, { runId: 'r1', actor: 'agent' })

    const activity = computeActivity(l.events)

    expect(activity.runs).toHaveLength(1)
    expect(activity.runs[0]).toMatchObject({
      runId: 'r1',
      status: 'running',
      currentStageName: 'Implement',
      agentCount: 1
    })
    expect(activity.agents).toHaveLength(1)
    expect(activity.agents[0]).toMatchObject({
      agentRunId: 'a1',
      personaName: 'Dev',
      contextPercent: 75,
      contextLevel: 'warn',
      lastActivity: 'working'
    })
    expect(activity.maxContextPercent).toBe(75)
    expect(activity.pressureLevel).toBe('warn')
    expect(activity.warnCount).toBe(1)
    expect(activity.highCount).toBe(0)
  })

  it('excludes finished runs and finished agents', () => {
    const l = log()
    l.add('run.started', { runId: 'r2' }, { runId: 'r2' })
    l.add('agent.spawned', { agentRunId: 'a2', personaName: 'Dev', model: 'm' }, { runId: 'r2', actor: 'agent' })
    l.add('agent.finished', { agentRunId: 'a2' }, { runId: 'r2', actor: 'agent' })
    l.add('run.finished', { runId: 'r2', status: 'passed' }, { runId: 'r2' })

    const activity = computeActivity(l.events)
    expect(activity.runs).toHaveLength(0)
    expect(activity.agents).toHaveLength(0)
    expect(activity.pressureLevel).toBe('ok')
  })

  it('reflects a pending human checkpoint as awaiting_checkpoint', () => {
    const l = log()
    l.add('run.started', { runId: 'r3' }, { runId: 'r3' })
    l.add('run.stage_entered', { stageName: 'Review' }, { runId: 'r3' })
    l.add('run.checkpoint_awaiting', { checkpointId: 'g1' }, { runId: 'r3' })

    const activity = computeActivity(l.events)
    expect(activity.runs[0]).toMatchObject({ status: 'awaiting_checkpoint', currentStageName: 'Review' })
  })

  it('flags high pressure across agents', () => {
    const l = log()
    l.add('agent.spawned', { agentRunId: 'a', personaName: 'X', model: 'm' }, { actor: 'agent' })
    l.add('agent.context_pressure', { agentRunId: 'a', percent: 95 }, { actor: 'agent' })
    l.add('agent.spawned', { agentRunId: 'b', personaName: 'Y', model: 'm' }, { actor: 'agent' })
    l.add('agent.context_pressure', { agentRunId: 'b', percent: 30 }, { actor: 'agent' })

    const activity = computeActivity(l.events)
    expect(activity.maxContextPercent).toBe(95)
    expect(activity.pressureLevel).toBe('high')
    expect(activity.highCount).toBe(1)
    // Standalone agents (no run) still show up.
    expect(activity.agents.map((a) => a.agentRunId).sort()).toEqual(['a', 'b'])
  })
})
