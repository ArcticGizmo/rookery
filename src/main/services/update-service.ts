import type { AuditLog } from './audit-log'

/**
 * The slice of electron-updater's `autoUpdater` this service depends on. Kept as
 * a narrow port so the projection logic is unit-testable with a fake, without
 * pulling the real updater (which needs a packaged app + network) into tests.
 */
export interface Updater {
  autoDownload: boolean
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

/**
 * Auto-update wiring (Phase 7.3). Projects the updater's lifecycle into the
 * audit log so update state is recorded and — because notifications derive from
 * the event stream — surfaces to the user like everything else. Holds no update
 * server config itself (that lives in electron-builder's `publish` block);
 * `updater` is injected so this is testable and dev/prod agnostic.
 *
 * Only meaningful transitions are logged: an update becoming available, a
 * download completing (the actionable "restart to install" moment), and errors.
 * Routine "checking" / "up to date" states are intentionally not audited.
 */
export class UpdateService {
  private started = false

  constructor(
    private readonly updater: Updater,
    private readonly audit: AuditLog
  ) {}

  /** Subscribe to updater events and project them to the audit log. Idempotent. */
  start(): void {
    if (this.started) return
    this.started = true
    this.updater.autoDownload = true

    this.updater.on('update-available', (info) => {
      this.emit({
        type: 'app.update_available',
        actor: 'system',
        payload: { version: info.version }
      })
    })
    this.updater.on('update-downloaded', (info) => {
      this.emit({
        type: 'app.update_downloaded',
        actor: 'system',
        payload: { version: info.version }
      })
    })
    this.updater.on('error', (error) => {
      this.emit({ type: 'app.update_error', actor: 'system', payload: { message: error.message } })
    })
  }

  /**
   * Ask the update server whether a newer release exists. Failures (offline, no
   * publish config) are swallowed — they also arrive via the `error` event, and
   * a failed check must never take down the app. Callers guard on `isPackaged`
   * before invoking, since electron-updater rejects in an unpackaged dev app.
   */
  async check(): Promise<void> {
    try {
      await this.updater.checkForUpdates()
    } catch {
      // Already surfaced via the 'error' event; nothing more to do here.
    }
  }

  /** Quit and install a downloaded update (the "restart to update" action). */
  install(): void {
    this.updater.quitAndInstall()
  }

  private emit(event: Parameters<AuditLog['append']>[0]): void {
    void this.audit.append(event).catch((error) => {
      console.error('Failed to append update event:', error)
    })
  }
}
