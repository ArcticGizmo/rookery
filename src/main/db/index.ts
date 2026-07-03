import { pathToFileURL } from 'node:url'
import { type Client, createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

export type Db = LibSQLDatabase<typeof schema>

let client: Client | null = null
let dbInstance: Db | null = null

/** Open the database (idempotent). Returns the shared Drizzle instance. */
export function initDb(dbPath: string): Db {
  if (dbInstance) return dbInstance
  client = createClient({ url: pathToFileURL(dbPath).toString() })
  dbInstance = drizzle(client, { schema })
  return dbInstance
}

/**
 * Connection hardening (Phase 7.1). Local libsql defaults to a rollback journal
 * with no busy timeout, which is fragile for us: two services write
 * concurrently (the run store's transactions and the audit log's appends), so a
 * lock collision would otherwise fail immediately with SQLITE_BUSY, and a crash
 * mid-write leaves a rollback journal to replay.
 *
 * - `journal_mode = WAL`: keeps the database consistent if the process dies
 *   mid-write and lets readers proceed during a write. Persists in the file, so
 *   it only takes effect once, but is cheap to re-assert on every open.
 * - `busy_timeout = 5000`: a contended writer waits up to 5s for the lock
 *   instead of erroring out. Per-connection, so it must be set on each open.
 *
 * Call once after {@link initDb}, before running migrations or serving queries.
 */
export async function configureConnection(db: Db): Promise<void> {
  await db.run(sql`PRAGMA journal_mode = WAL`)
  await db.run(sql`PRAGMA busy_timeout = 5000`)
}

export function getDb(): Db {
  if (!dbInstance) throw new Error('Database not initialized. Call initDb() first.')
  return dbInstance
}

/**
 * Debug-only: delete every row from every table, returning the database to its
 * freshly-migrated (empty) state. Deletes children before parents so it holds
 * even if a foreign key lacks `onDelete: 'cascade'`. Kept out of a transaction
 * to stay compatible with in-memory test databases (see MEMORY).
 */
export async function resetAllData(db: Db): Promise<void> {
  await db.delete(schema.stageExecutions)
  await db.delete(schema.runs)
  await db.delete(schema.specVersions)
  await db.delete(schema.repos)
  await db.delete(schema.briefs)
  await db.delete(schema.approachDefs)
  await db.delete(schema.events)
}

export function closeDb(): void {
  client?.close()
  client = null
  dbInstance = null
}
