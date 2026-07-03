/**
 * Notification projection (Phase 6.5). Pure and derived entirely from the event
 * log — the store layers read/dismissed UI state on top; it never invents
 * attention state the log doesn't record. Surfaces the two things a human needs
 * to react to: a run awaiting a human checkpoint (Phase 4.4), and an agent crossing
 * into high context pressure (Phase 3.5).
 */

import type { PressureLevel } from './context-pressure'
import type { StoredEvent } from './events'

export type NotificationKind = 'checkpoint' | 'pressure' | 'update'

export interface NotificationItem {
  /** The triggering event's id — stable + unique, so read-state dedupes cleanly. */
  id: number
  kind: NotificationKind
  runId: string | null
  title: string
  body: string
  ts: string
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

/**
 * Reduce the event log to attention-worthy notifications, oldest first. Each
 * `run.checkpoint_awaiting` is a distinct wait, so it maps 1:1. High context pressure
 * fires only on the *rising edge* — a turn that first crosses into `high` for an
 * agent — so a long run doesn't emit one per turn; a later turn back under high
 * re-arms it. A downloaded update (Phase 7.3) is the actionable "restart to
 * install" moment.
 */
export function computeNotifications(events: StoredEvent[]): NotificationItem[] {
  const items: NotificationItem[] = []
  const agentLevel = new Map<string, PressureLevel>()

  for (const event of events) {
    const p = payloadOf(event)

    if (event.type === 'app.update_downloaded') {
      items.push({
        id: event.id,
        kind: 'update',
        runId: null,
        title: 'Update ready',
        body: `Version ${String(p.version ?? '')} has been downloaded. Restart Rookery to install it.`,
        ts: event.ts
      })
      continue
    }

    if (event.type === 'run.checkpoint_awaiting') {
      items.push({
        id: event.id,
        kind: 'checkpoint',
        runId: event.runId,
        title: 'Human checkpoint awaiting',
        body: String(p.description || 'A run needs your approval to continue.'),
        ts: event.ts
      })
      continue
    }

    if (event.type === 'agent.context_pressure') {
      const agentRunId = String(p.agentRunId ?? '')
      const level = ((p.level as PressureLevel) ?? 'ok') as PressureLevel
      const prev = agentLevel.get(agentRunId) ?? 'ok'
      if (level === 'high' && prev !== 'high') {
        items.push({
          id: event.id,
          kind: 'pressure',
          runId: event.runId,
          title: 'High context pressure',
          body: `An agent is at ${Number(p.percent ?? 0)}% of its context window — output quality may degrade.`,
          ts: event.ts
        })
      }
      agentLevel.set(agentRunId, level)
    }
  }

  return items
}
