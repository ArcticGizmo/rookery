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
      flightId: event.flightId,
      stageId: event.stageId,
      payload: event.payload
    }
    this.rows.push(stored)
    return Promise.resolve({ ...stored })
  }

  list(options: ListEventsOptions = {}): Promise<StoredEvent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT
    const filtered = this.rows.filter((row) => matchesEvent(row, options))
    const ordered =
      options.order === 'desc'
        ? [...filtered].sort((a, b) => b.id - a.id)
        : [...filtered].sort((a, b) => a.id - b.id)
    return Promise.resolve(ordered.slice(0, limit).map((row) => ({ ...row })))
  }
}

/**
 * Predicate mirroring `SqliteEventStore.list` filtering, so tests (in-memory) and
 * production (libsql) agree on `ListEventsOptions` semantics.
 */
function matchesEvent(row: StoredEvent, o: ListEventsOptions): boolean {
  if (o.afterId !== undefined && !(row.id > o.afterId)) return false
  if (o.beforeId !== undefined && !(row.id < o.beforeId)) return false
  if (o.flightId && row.flightId !== o.flightId) return false
  if (o.stageId && row.stageId !== o.stageId) return false
  if (o.actor && row.actor !== o.actor) return false
  if (o.type && !row.type.startsWith(o.type)) return false
  if (o.since && row.ts < o.since) return false
  if (o.until && row.ts > o.until) return false
  if (o.search) {
    const haystack = `${row.type} ${JSON.stringify(row.payload)}`.toLowerCase()
    if (!haystack.includes(o.search.toLowerCase())) return false
  }
  return true
}
