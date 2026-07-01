import { pathToFileURL } from 'node:url'
import { type Client, createClient } from '@libsql/client'
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

export function getDb(): Db {
  if (!dbInstance) throw new Error('Database not initialized. Call initDb() first.')
  return dbInstance
}

export function closeDb(): void {
  client?.close()
  client = null
  dbInstance = null
}
