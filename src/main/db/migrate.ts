import { join } from 'node:path'
import { app } from 'electron'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Db } from './index'

/**
 * Apply pending migrations from the `drizzle/` folder. In development and when
 * running unpackaged the folder sits at the project root (cwd); in a packaged
 * app it is bundled under resources (see electron-builder `extraResources`).
 */
export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')
  await migrate(db, { migrationsFolder })
}
