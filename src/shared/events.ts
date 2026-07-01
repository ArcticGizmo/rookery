/**
 * Append-only audit/event log types. The discriminated union grows as later
 * phases add behavior (spec edits, agent lifecycle, gates, transitions).
 */

export type EventActor = 'system' | 'human' | 'agent'

export type AppEvent =
  | { type: 'app.booted'; actor: 'system'; payload: { version: string; platform: string } }
  | { type: 'app.shutdown'; actor: 'system'; payload: Record<string, never> }
  // Phase 2 — work items, spec versioning, workflow definitions.
  | { type: 'workitem.created'; actor: 'human'; payload: { workItemId: string; title: string } }
  | { type: 'workitem.updated'; actor: 'human'; payload: { workItemId: string; title: string } }
  | { type: 'workitem.deleted'; actor: 'human'; payload: { workItemId: string } }
  | {
      type: 'spec.version_created'
      actor: 'human'
      payload: { workItemId: string; version: number; contentHash: string }
    }
  | {
      type: 'workflow.created'
      actor: 'human'
      payload: { workflowId: string; name: string; version: number }
    }
  | {
      type: 'workflow.updated'
      actor: 'human'
      payload: { workflowId: string; name: string; version: number }
    }
  | { type: 'workflow.deleted'; actor: 'human'; payload: { workflowId: string } }

/** Optional scoping fields common to every appended event. */
export interface EventScope {
  runId?: string | null
  stageId?: string | null
}

/** A persisted event as read back from the log. `id` is the monotonic sequence. */
export interface StoredEvent {
  id: number
  ts: string
  type: AppEvent['type']
  actor: EventActor
  runId: string | null
  stageId: string | null
  payload: unknown
}

export interface ListEventsOptions {
  /** Return only events with `id` greater than this (for incremental sync). */
  afterId?: number
  /** Maximum number of rows to return (default 500). */
  limit?: number
}
