import type { ListEventsOptions, StoredEvent } from '@shared/events'
import { DEFAULT_LIST_LIMIT, type EventStore, type NewEvent } from './event-store'

/**
 * In-memory event store for unit tests. Insert-only (no update/delete), and
 * returns copies so callers can't mutate stored rows — mirroring the append-only
 * guarantee of the SQLite store without requiring a native database.
 */
export class InMemoryEventStore implements EventStore {
  private readonly rows: StoredEvent[] = []
  private nextId = 1

  insert(event: NewEvent): Promise<StoredEvent> {
    const stored: StoredEvent = {
      id: this.nextId++,
      ts: event.ts,
      type: event.type as StoredEvent['type'],
      actor: event.actor,
      runId: event.runId,
      stageId: event.stageId,
      payload: event.payload
    }
    this.rows.push(stored)
    return Promise.resolve({ ...stored })
  }

  list(options: ListEventsOptions = {}): Promise<StoredEvent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT
    const filtered =
      options.afterId !== undefined
        ? this.rows.filter((row) => row.id > (options.afterId as number))
        : this.rows
    return Promise.resolve(filtered.slice(0, limit).map((row) => ({ ...row })))
  }
}
