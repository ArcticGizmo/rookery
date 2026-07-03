import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApproachDefBody } from '../../src/shared/domain'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { ApproachService } from '../../src/main/services/approach-service'
import { makeTestDb, type TestDb } from './helpers/test-db'

function body(name: string): ApproachDefBody {
  return {
    name,
    description: 'A approach',
    stages: [
      {
        id: 's1',
        name: 'Review',
        type: 'review',
        personas: [{ id: 'p1', name: 'Lead', role: 'Tech Lead', systemPrompt: 'Review', model: undefined }],
        passCriteria: [],
        checkpoints: [{ id: 'g1', kind: 'human', description: 'Approve' }]
      }
    ]
  }
}

describe('ApproachService', () => {
  let test: TestDb
  let audit: AuditLog
  let service: ApproachService

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    service = new ApproachService(test.db, audit)
  })

  afterEach(() => test.close())

  it('creates a approach at version 1 and audits it', async () => {
    const wf = await service.create(body('Feature flow'))
    expect(wf.version).toBe(1)
    expect(wf.name).toBe('Feature flow')
    expect(wf.stages).toHaveLength(1)

    const events = await audit.list()
    expect(events.some((e) => e.type === 'approach.created')).toBe(true)
  })

  it('round-trips the stage body through JSON storage', async () => {
    const created = await service.create(body('Round trip'))
    const fetched = await service.get(created.id)
    expect(fetched?.stages[0]?.personas[0]?.role).toBe('Tech Lead')
    expect(fetched?.stages[0]?.checkpoints[0]?.kind).toBe('human')
  })

  it('bumps the version on update and audits it', async () => {
    const created = await service.create(body('V1'))
    const updated = await service.update(created.id, body('V2'))
    expect(updated.version).toBe(2)
    expect(updated.name).toBe('V2')

    const events = await audit.list()
    expect(events.filter((e) => e.type === 'approach.updated')).toHaveLength(1)
  })

  it('lists and deletes approaches', async () => {
    const created = await service.create(body('Doomed'))
    expect(await service.list()).toHaveLength(1)
    await service.delete(created.id)
    expect(await service.list()).toHaveLength(0)
    expect(await service.get(created.id)).toBeNull()

    const events = await audit.list()
    expect(events.some((e) => e.type === 'approach.deleted')).toBe(true)
  })

  it('throws when updating a missing approach', async () => {
    await expect(service.update('nope', body('X'))).rejects.toThrow()
  })
})
