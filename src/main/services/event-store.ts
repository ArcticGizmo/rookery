import type { EventActor, ListEventsOptions, StoredEvent } from '@shared/events'

/** A row about to be inserted (id + ts already resolved by the caller/store). */
export interface NewEvent {
  ts: string
  type: string
  actor: EventActor
  flightId: string | null
  stageId: string | null
  payload: unknown
}

/**
 * Persistence port for the append-only event log. Implemented by
 * `SqliteEventStore` (libsql, used by the app) and `InMemoryEventStore` (tests).
 */
export interface EventStore {
  insert(event: NewEvent): Promise<StoredEvent>
  list(options?: ListEventsOptions): Promise<StoredEvent[]>
}

export const DEFAULT_LIST_LIMIT = 500
