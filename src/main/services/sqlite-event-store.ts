import { type SQL, and, asc, desc, eq, gt, gte, like, lt, lte, sql } from 'drizzle-orm'
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
        flightId: event.flightId,
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
    const conditions: SQL[] = []
    if (options.afterId !== undefined) conditions.push(gt(events.id, options.afterId))
    if (options.beforeId !== undefined) conditions.push(lt(events.id, options.beforeId))
    if (options.flightId) conditions.push(eq(events.flightId, options.flightId))
    if (options.stageId) conditions.push(eq(events.stageId, options.stageId))
    if (options.actor) conditions.push(eq(events.actor, options.actor))
    if (options.type) conditions.push(like(events.type, `${options.type}%`))
    if (options.since) conditions.push(gte(events.ts, options.since))
    if (options.until) conditions.push(lte(events.ts, options.until))
    if (options.search) {
      const q = `%${options.search}%`
      // `payload` is a JSON text column; match against its serialized form.
      conditions.push(sql`(${events.type} LIKE ${q} OR ${events.payload} LIKE ${q})`)
    }

    const where = conditions.length ? and(...conditions) : undefined
    const orderBy = options.order === 'desc' ? desc(events.id) : asc(events.id)
    const rows = await this.db.select().from(events).where(where).orderBy(orderBy).limit(limit)
    return rows.map(toStored)
  }
}

function toStored(row: EventRow): StoredEvent {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type as StoredEvent['type'],
    actor: row.actor as EventActor,
    flightId: row.flightId,
    stageId: row.stageId,
    payload: row.payload
  }
}
