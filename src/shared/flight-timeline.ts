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
