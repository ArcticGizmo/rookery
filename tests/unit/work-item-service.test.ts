import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { SpecService } from '../../src/main/services/spec-service'
import { WorkItemService } from '../../src/main/services/work-item-service'
import { makeTestDb, type TestDb } from './helpers/test-db'

describe('WorkItemService', () => {
  let test: TestDb
  let audit: AuditLog
  let service: WorkItemService

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    const specs = new SpecService(test.db, audit)
    service = new WorkItemService(test.db, audit, specs)
  })

  afterEach(() => test.close())

  it('creates a work item with repos and an initial spec version', async () => {
    const detail = await service.create({
      title: 'Add login',
      spec: '# Login\nSupport SSO',
      repos: [{ name: 'api', localPath: 'C:/git/api', remoteUrl: 'https://example.com/api' }]
    })

    expect(detail.workItem.title).toBe('Add login')
    expect(detail.repos).toHaveLength(1)
    expect(detail.repos[0]!.name).toBe('api')
    expect(detail.repos[0]!.remoteUrl).toBe('https://example.com/api')
    expect(detail.currentSpec?.version).toBe(1)
    expect(detail.currentSpec?.content).toBe('# Login\nSupport SSO')
  })

  it('audits creation and the initial spec version', async () => {
    await service.create({ title: 'X', spec: 'body', repos: [] })
    const events = await audit.list()
    expect(events.some((e) => e.type === 'workitem.created')).toBe(true)
    expect(events.some((e) => e.type === 'spec.version_created')).toBe(true)
  })

  it('lists created items, newest first', async () => {
    await service.create({ title: 'First', spec: '', repos: [] })
    await service.create({ title: 'Second', spec: '', repos: [] })
    const items = await service.list()
    expect(items.map((i) => i.title)).toContain('First')
    expect(items).toHaveLength(2)
  })

  it('replaces repos on update and audits it', async () => {
    const created = await service.create({
      title: 'Feature',
      spec: '',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const updated = await service.update(created.workItem.id, {
      title: 'Feature renamed',
      repos: [{ name: 'web', localPath: 'C:/git/web' }]
    })
    expect(updated.workItem.title).toBe('Feature renamed')
    expect(updated.repos).toHaveLength(1)
    expect(updated.repos[0]!.name).toBe('web')

    const events = await audit.list()
    expect(events.some((e) => e.type === 'workitem.updated')).toBe(true)
  })

  it('normalizes an empty remote URL to undefined', async () => {
    const detail = await service.create({
      title: 'Y',
      spec: '',
      repos: [{ name: 'api', localPath: 'C:/git/api', remoteUrl: '' }]
    })
    expect(detail.repos[0]!.remoteUrl).toBeUndefined()
  })

  it('rejects an invalid remote URL', async () => {
    await expect(
      service.create({
        title: 'Z',
        spec: '',
        repos: [{ name: 'api', localPath: 'C:/git/api', remoteUrl: 'not-a-url' }]
      })
    ).rejects.toThrow()
  })

  it('deletes a work item and its spec versions', async () => {
    const created = await service.create({ title: 'ToDelete', spec: 'x', repos: [] })
    await service.delete(created.workItem.id)
    expect(await service.get(created.workItem.id)).toBeNull()
    const events = await audit.list()
    expect(events.some((e) => e.type === 'workitem.deleted')).toBe(true)
  })
})
