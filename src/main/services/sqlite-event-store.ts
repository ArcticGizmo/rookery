import { asc, gt } from 'drizzle-orm'
import type { EventActor, ListEventsOptions, StoredEvent } from '@shared/events'
import type { Db } from '../db'
import { type EventRow, events } from '../db/schema'
import { DEFAULT_LIST_LIMIT, type EventStore, type NewEvent } from './event-store'

/** libsql/Drizzle-backed event store. Used by the running application. */
export class SqliteEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async insert(event: NewEvent): Promise<StoredEvent> {
    const rows = await this.db
      .insert(events)
      .values({
        ts: event.ts,
        type: event.type,
        actor: event.actor,
        runId: event.runId,
        stageId: event.stageId,
        payload: event.payload
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Insert returned no row')
    return toStored(row)
  }

  async list(options: ListEventsOptions = {}): Promise<StoredEvent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT
    const rows =
      options.afterId !== undefined
        ? await this.db
            .select()
            .from(events)
            .where(gt(events.id, options.afterId))
            .orderBy(asc(events.id))
            .limit(limit)
        : await this.db.select().from(events).orderBy(asc(events.id)).limit(limit)
    return rows.map(toStored)
  }
}

function toStored(row: EventRow): StoredEvent {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type as StoredEvent['type'],
    actor: row.actor as EventActor,
    runId: row.runId,
    stageId: row.stageId,
    payload: row.payload
  }
}
