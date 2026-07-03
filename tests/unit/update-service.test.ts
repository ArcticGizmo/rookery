import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { type Updater, UpdateService } from '../../src/main/services/update-service'

/** A fake electron-updater: records subscriptions so tests can fire events. */
class FakeUpdater implements Updater {
  autoDownload = false
  quitAndInstall = vi.fn()
  checkForUpdates = vi.fn(async () => ({}))
  private listeners = new Map<string, (arg: unknown) => void>()

  on(event: string, listener: (arg: never) => void): unknown {
    this.listeners.set(event, listener as (arg: unknown) => void)
    return this
  }

  fire(event: string, arg: unknown): void {
    this.listeners.get(event)?.(arg)
  }
}

/** Wait until the audit log holds an event of `type` (appends are async). */
async function waitForEvent(audit: AuditLog, type: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const events = await audit.list()
    if (events.some((e) => e.type === type)) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`No ${type} event before timeout`)
}

describe('UpdateService (Phase 7.3)', () => {
  let updater: FakeUpdater
  let audit: AuditLog
  let service: UpdateService

  beforeEach(() => {
    updater = new FakeUpdater()
    audit = new AuditLog(new InMemoryEventStore())
    service = new UpdateService(updater, audit)
  })

  it('enables auto-download and is idempotent', () => {
    const spy = vi.spyOn(updater, 'on')
    service.start()
    service.start()
    expect(updater.autoDownload).toBe(true)
    // Three distinct events wired exactly once despite two start() calls.
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('projects update-available to an audit event', async () => {
    service.start()
    updater.fire('update-available', { version: '2.0.0' })
    await waitForEvent(audit, 'app.update_available')
    const [event] = await audit.list()
    expect(event).toMatchObject({ type: 'app.update_available' })
    expect((event!.payload as { version: string }).version).toBe('2.0.0')
  })

  it('projects update-downloaded to an audit event', async () => {
    service.start()
    updater.fire('update-downloaded', { version: '2.0.0' })
    await waitForEvent(audit, 'app.update_downloaded')
    const [event] = await audit.list()
    expect((event!.payload as { version: string }).version).toBe('2.0.0')
  })

  it('projects updater errors to an audit event', async () => {
    service.start()
    updater.fire('error', new Error('network down'))
    await waitForEvent(audit, 'app.update_error')
    const [event] = await audit.list()
    expect((event!.payload as { message: string }).message).toBe('network down')
  })

  it('swallows a failing check (already surfaced via the error event)', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('not packed'))
    service.start()
    await expect(service.check()).resolves.toBeUndefined()
  })

  it('delegates install to the updater', () => {
    service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })
})
