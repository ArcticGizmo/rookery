import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { SpecService } from '../../src/main/services/spec-service'
import { briefs } from '../../src/main/db/schema'
import { makeTestDb, type TestDb } from './helpers/test-db'

const WORK_ITEM_ID = 'wi-1'

describe('SpecService', () => {
  let test: TestDb
  let audit: AuditLog
  let specs: SpecService

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    specs = new SpecService(test.db, audit)
    const now = new Date().toISOString()
    await test.db
      .insert(briefs)
      .values({ id: WORK_ITEM_ID, title: 'Item', createdAt: now, updatedAt: now })
  })

  afterEach(() => test.close())

  it('creates version 1 on first save', async () => {
    const v1 = await specs.saveSpec(WORK_ITEM_ID, 'hello')
    expect(v1.version).toBe(1)
    expect(v1.content).toBe('hello')
    expect(v1.contentHash).toHaveLength(64)
  })

  it('does not create a new version when content is unchanged', async () => {
    const v1 = await specs.saveSpec(WORK_ITEM_ID, 'hello')
    const again = await specs.saveSpec(WORK_ITEM_ID, 'hello')
    expect(again.version).toBe(v1.version)
    expect(await specs.history(WORK_ITEM_ID)).toHaveLength(1)
  })

  it('creates a new version when content changes', async () => {
    await specs.saveSpec(WORK_ITEM_ID, 'hello')
    const v2 = await specs.saveSpec(WORK_ITEM_ID, 'hello world')
    expect(v2.version).toBe(2)
    const history = await specs.history(WORK_ITEM_ID)
    expect(history.map((v) => v.version)).toEqual([1, 2])
  })

  it('emits a spec.version_created audit event per new version', async () => {
    await specs.saveSpec(WORK_ITEM_ID, 'a')
    await specs.saveSpec(WORK_ITEM_ID, 'a') // no-op
    await specs.saveSpec(WORK_ITEM_ID, 'b')
    const events = await audit.list()
    expect(events.filter((e) => e.type === 'spec.version_created')).toHaveLength(2)
  })

  it('produces a line diff between versions', async () => {
    await specs.saveSpec(WORK_ITEM_ID, 'line one\nline two')
    await specs.saveSpec(WORK_ITEM_ID, 'line one\nline two changed')
    const diff = await specs.diff(WORK_ITEM_ID, 1, 2)
    expect(diff.lines.some((l) => l.kind === 'removed' && l.value === 'line two')).toBe(true)
    expect(diff.lines.some((l) => l.kind === 'added' && l.value === 'line two changed')).toBe(true)
    expect(diff.lines.some((l) => l.kind === 'unchanged' && l.value === 'line one')).toBe(true)
  })

  it('throws when diffing a missing version', async () => {
    await specs.saveSpec(WORK_ITEM_ID, 'only one')
    await expect(specs.diff(WORK_ITEM_ID, 1, 2)).rejects.toThrow()
  })
})
