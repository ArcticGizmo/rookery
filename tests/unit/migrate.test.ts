import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/main/db/schema'
import {
  appliedMigrationCount,
  assertForwardCompatible,
  bundledMigrationCount,
  runMigrations
} from '../../src/main/db/migrate'
import { makeTestDb, type TestDb } from './helpers/test-db'

describe('migration guardrails (Phase 7.2)', () => {
  describe('assertForwardCompatible', () => {
    it('allows a database at or behind the build', () => {
      expect(() => assertForwardCompatible(0, 5)).not.toThrow()
      expect(() => assertForwardCompatible(5, 5)).not.toThrow()
      expect(() => assertForwardCompatible(3, 5)).not.toThrow()
    })

    it('rejects a database newer than the build (downgrade guard)', () => {
      expect(() => assertForwardCompatible(6, 5)).toThrow(/newer version/i)
    })
  })

  it('bundledMigrationCount matches the committed migrations', () => {
    // The repo ships 6 migrations (drizzle/meta/_journal.json).
    expect(bundledMigrationCount('drizzle')).toBe(6)
  })

  it('appliedMigrationCount reflects a freshly-migrated database', async () => {
    const test: TestDb = await makeTestDb() // makeTestDb applies every bundled migration
    try {
      expect(await appliedMigrationCount(test.db)).toBe(bundledMigrationCount('drizzle'))
    } finally {
      test.close()
    }
  })

  it('appliedMigrationCount is 0 before any migration table exists', async () => {
    // A raw, never-migrated database: the __drizzle_migrations table is absent,
    // so the count must fall back to 0 rather than throwing.
    const client = createClient({
      url: pathToFileURL(join(tmpdir(), `rookery-raw-${randomUUID()}.db`)).toString()
    })
    const db = drizzle(client, { schema })
    try {
      expect(await appliedMigrationCount(db)).toBe(0)
    } finally {
      client.close()
    }
  })

  it('runMigrations refuses a database ahead of the build', async () => {
    const test = await makeTestDb() // already at the latest bundled version
    try {
      // Point at a folder whose journal claims fewer migrations than are applied,
      // simulating an older build meeting a newer database.
      await expect(runMigrations(test.db, 'tests/unit/fixtures/older-build')).rejects.toThrow(
        /newer version/i
      )
    } finally {
      test.close()
    }
  })

  it('runMigrations is a no-op on an already-current database', async () => {
    const test = await makeTestDb()
    try {
      await expect(runMigrations(test.db, 'drizzle')).resolves.toBeUndefined()
      expect(await appliedMigrationCount(test.db)).toBe(bundledMigrationCount('drizzle'))
    } finally {
      test.close()
    }
  })
})
