import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Append-only event log. `id` is the monotonic sequence (autoincrement PK).
 * Rows are never updated or deleted — the log is the source of truth.
 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    runId: text('run_id'),
    stageId: text('stage_id'),
    payload: text('payload', { mode: 'json' }).notNull()
  },
  (table) => [
    index('idx_events_type').on(table.type),
    index('idx_events_run_id').on(table.runId),
    index('idx_events_ts').on(table.ts)
  ]
)

export type EventRow = typeof events.$inferSelect
