import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from '../../../src/main/db/schema'
import { type Db, configureConnection } from '../../../src/main/db'

export interface TestDb {
  db: Db
  close: () => void
}

/**
 * A fresh temp-file libsql database with all migrations applied.
 *
 * We use a real file (not `:memory:`) because libsql gives each connection to
 * `:memory:` its own independent database — so a `db.transaction()`, which flights
 * on a separate connection, would not see the migrated tables. A file URL is
 * shared across connections, matching how the app opens its database.
 */
export async function makeTestDb(): Promise<TestDb> {
  const path = join(tmpdir(), `rookery-test-${randomUUID()}.db`)
  const client = createClient({ url: pathToFileURL(path).toString() })
  const db = drizzle(client, { schema })
  await configureConnection(db)
  await migrate(db, { migrationsFolder: 'drizzle' })
  return {
    db,
    close: () => {
      client.close()
      // Best-effort cleanup: Windows may still hold the handle briefly after
      // close(). Leftover temp files are harmless (the OS reaps tmpdir).
      for (const suffix of ['', '-wal', '-shm']) {
        const file = `${path}${suffix}`
        try {
          if (existsSync(file)) rmSync(file, { force: true })
        } catch {
          // ignore
        }
      }
    }
  }
}
