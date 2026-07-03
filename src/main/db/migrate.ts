import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Db } from './index'

/**
 * Migration policy (Phase 7.2): **forward-only**. Migrations in `drizzle/` are
 * applied in order and never rolled back or edited after shipping — a schema
 * change is always a new migration. The database's schema version is therefore
 * the number of migrations it has applied, which only ever increases.
 *
 * The guardrail this policy needs is against running an *older* build against a
 * *newer* database (e.g. after a downgrade): the old binary's code expects an
 * old schema, but the DB has already advanced. drizzle's migrator silently
 * applies nothing in that case, leaving a version skew that corrupts data or
 * crashes at query time. So before migrating we compare the DB's applied count
 * to the count bundled with this build and refuse to start if the DB is ahead.
 */

interface DrizzleJournal {
  entries: { idx: number; tag: string }[]
}

/** How many migrations ship with this build — the app's known schema version. */
export function bundledMigrationCount(migrationsFolder: string): number {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as DrizzleJournal
  return journal.entries.length
}

/** How many migrations the database has already applied. 0 on a fresh DB. */
export async function appliedMigrationCount(db: Db): Promise<number> {
  try {
    const row = await db.get<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`)
    return row?.n ?? 0
  } catch {
    // The bookkeeping table doesn't exist yet — nothing has been applied.
    return 0
  }
}

/**
 * Enforce the forward-only policy: a database that has applied more migrations
 * than this build knows about was written by a newer Rookery and must not be
 * opened by this (older) one.
 */
export function assertForwardCompatible(applied: number, bundled: number): void {
  if (applied > bundled) {
    throw new Error(
      `This database is at schema version ${applied}, but this build of Rookery only ` +
        `supports up to version ${bundled}. The database was created by a newer version — ` +
        `please update Rookery. Migrations are forward-only and are never downgraded.`
    )
  }
}

/**
 * Apply pending migrations from `migrationsFolder`, after checking the DB isn't
 * ahead of this build (see the policy note above). Flights on boot, before the
 * window loads; a thrown incompatibility surfaces via the fatal-startup handler
 * in `main/index.ts`. The caller resolves the folder (project root in dev,
 * bundled resources when packaged) so this stays free of Electron and testable.
 */
export async function runMigrations(db: Db, migrationsFolder: string): Promise<void> {
  assertForwardCompatible(await appliedMigrationCount(db), bundledMigrationCount(migrationsFolder))
  await migrate(db, { migrationsFolder })
}
