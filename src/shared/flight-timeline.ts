/**
 * Partitioning a flight's event stream into per-stage slices (Phase J7.3), so a
 * milestone can expand to exactly the activity that happened inside its stage.
 *
 * Agent events (`agent.message`, `agent.tool_use`, …) are scoped to the flight
 * but not the stage — the engine spawns stage agents with only a `flightId`. So
 * we can't group by `event.stageId` alone. Instead we walk the stream in order
 * and attribute each event to the stage most recently entered (the last
 * `flight.stage_entered` marker), which is where it chronologically belongs.
 * Re-entering a stage (iterations, or a route-back after a checkpoint) appends
 * to that same stage's slice. Pure and framework-free so it can be unit-tested.
 */

import type { StoredEvent } from './events'

/**
 * Group events by the stage id they occurred under. Events before the first
 * `flight.stage_entered` (flight creation, early infra) belong to no stage and
 * are omitted. The insertion order within each slice is preserved.
 */
export function eventsByStage(events: StoredEvent[]): Map<string, StoredEvent[]> {
  const byStage = new Map<string, StoredEvent[]>()
  let current: string | null = null
  for (const event of events) {
    if (event.type === 'flight.stage_entered') {
      const stageId = (event.payload as { stageId?: string }).stageId ?? event.stageId
      if (stageId) current = stageId
    }
    if (!current) continue
    const slice = byStage.get(current)
    if (slice) slice.push(event)
    else byStage.set(current, [event])
  }
  return byStage
}

// --- "Right now" (J7.4): who's working + context pressure -------------------

/** An agent currently in the air (spawned, not yet finished/errored/cancelled). */
export interface ActiveAgent {
  agentRunId: string
  personaName: string
  model: string
}

/** The most recent context-pressure reading, with its health band. */
export interface PressureReading {
  percent: number
  level: 'ok' | 'warn' | 'high'
}

export interface RightNow {
  agents: ActiveAgent[]
  pressure: PressureReading | null
}

// --- "What I tried" (J8.1): the story behind an escalation -------------------

/** One thing the agents attempted (and how it went), for the beacon's detail. */
export interface TriedItem {
  label: string
  detail: string
}

/**
 * Build the "what I tried" list for a stage from its events — the failed
 * criteria and verification attempts that explain why a decision is now the
 * human's. Ordered oldest-first; empty when the stage simply awaits sign-off.
 * Pure so the beacon can render it and it can be unit-tested.
 */
export function whatITried(stageEvents: StoredEvent[]): TriedItem[] {
  const tried: TriedItem[] = []
  for (const event of stageEvents) {
    const p = event.payload as Record<string, unknown>
    if (event.type === 'flight.criterion_evaluated' && p.passed === false) {
      tried.push({
        label: `${String(p.criterionType)} not met`,
        detail: String(p.detail ?? '').trim()
      })
    } else if (event.type === 'flight.verification_failed') {
      const cycle = Number(p.cycle ?? 0)
      const maxCycles = Number(p.maxCycles ?? 0)
      tried.push({
        label: `Verification failed (${cycle}/${maxCycles})`,
        detail: String(p.issues ?? '').trim()
      })
    }
  }
  return tried
}

/**
 * Fold the event stream into a live snapshot: which agents are working right
 * now and the latest context-pressure reading. An agent is active from its
 * `agent.spawned` until an `agent.finished` / `agent.error` / `agent.cancelled`
 * for the same run. Pure so it can be unit-tested and recomputed per frame.
 */
export function rightNow(events: StoredEvent[]): RightNow {
  const active = new Map<string, ActiveAgent>()
  let pressure: PressureReading | null = null
  for (const event of events) {
    const p = event.payload as Record<string, unknown>
    switch (event.type) {
      case 'agent.spawned':
        active.set(String(p.agentRunId), {
          agentRunId: String(p.agentRunId),
          personaName: String(p.personaName),
          model: String(p.model)
        })
        break
      case 'agent.finished':
      case 'agent.error':
      case 'agent.cancelled':
        active.delete(String(p.agentRunId))
        break
      case 'agent.context_pressure':
        pressure = { percent: Number(p.percent), level: p.level as PressureReading['level'] }
        break
    }
  }
  return { agents: [...active.values()], pressure }
}
