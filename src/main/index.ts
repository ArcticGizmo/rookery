import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { closeDb, configureConnection, initDb } from './db'
import { runMigrations } from './db/migrate'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { RunEngine } from './engine/run-engine'
import { registerIpc } from './ipc'
import { AgentService } from './services/agent-service'
import { AuditLog } from './services/audit-log'
import { createInfraProvider } from './services/infra'
import { InfraService } from './services/infra-service'
import { createLandingProvider } from './services/landing'
import { LandingService } from './services/landing-service'
import { LocalBranchService } from './services/local-branch-service'
import { RunStore } from './services/run-store'
import { SpecService } from './services/spec-service'
import { SqliteEventStore } from './services/sqlite-event-store'
import { UpdateService } from './services/update-service'
import { BriefService } from './services/brief-service'
import { ApproachService } from './services/approach-service'
import { WorkspaceService } from './services/workspace-service'

/** Re-check for updates on this cadence while the app stays open (6 hours). */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let auditLog: AuditLog | null = null
let shuttingDown = false
let updateTimer: ReturnType<typeof setInterval> | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  // Allow tests (and advanced users) to point at an alternate database file.
  const dbPath = process.env['ROOKERY_DB_PATH'] ?? join(app.getPath('userData'), 'rookery.db')
  const db = initDb(dbPath)
  await configureConnection(db)
  // Migrations live at the project root in dev and under resources when packaged.
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')
  await runMigrations(db, migrationsFolder)

  auditLog = new AuditLog(new SqliteEventStore(db))
  const specs = new SpecService(db, auditLog)
  const briefs = new BriefService(db, auditLog, specs)
  const approaches = new ApproachService(db, auditLog)
  const agent = new AgentService(auditLog, query)
  const runs = new RunStore(db)
  const infra = new InfraService(createInfraProvider(), auditLog)
  const localBranch = new LocalBranchService(auditLog)
  const engine = new RunEngine(runs, auditLog, agent, briefs, approaches, infra, localBranch)
  const landing = new LandingService(createLandingProvider(), auditLog, infra, briefs, runs)
  const workspace = new WorkspaceService()

  // Auto-update (Phase 7.3): project updater lifecycle into the audit log so it
  // surfaces through the normal notification pipeline. Checks only run in a
  // packaged app — electron-updater rejects in an unpackaged dev build.
  const update = new UpdateService(electronUpdater.autoUpdater, auditLog)
  update.start()

  registerIpc({
    db,
    auditLog,
    briefs,
    specs,
    approaches,
    agent,
    runs,
    engine,
    landing,
    workspace,
    update
  })

  await auditLog.append({
    type: 'app.booted',
    actor: 'system',
    payload: { version: app.getVersion(), platform: process.platform }
  })

  // Reconcile runs the previous session left mid-flight (Phase 7.1). Best-effort:
  // a failure here must not stop the app from starting.
  await engine
    .recoverInterruptedRuns()
    .catch((error) => console.error('Failed to recover interrupted runs:', error))

  // Check for updates on boot, then periodically. Packaged only.
  if (app.isPackaged) {
    void update.check()
    updateTimer = setInterval(() => void update.check(), UPDATE_CHECK_INTERVAL_MS)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

// A failure in bootstrap (e.g. the DB can't open or a migration fails) leaves
// the app with no window and no way forward. Surface it and exit cleanly rather
// than hanging as an invisible, wedged process (Phase 7.1).
app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error('Fatal error during startup:', error)
    dialog.showErrorBox(
      'Rookery failed to start',
      `The application could not start.\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    )
    app.exit(1)
  })

// Last-resort handlers so a stray error/rejection is logged rather than silently
// swallowed (Phase 7.1). We deliberately do not exit: the audit log and DB are
// the source of truth and remain intact; forcing a quit here would be worse than
// letting the affected operation fail in place.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in main process:', reason)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Record a shutdown event before quitting, then close the database.
app.on('before-quit', (event) => {
  if (updateTimer) {
    clearInterval(updateTimer)
    updateTimer = null
  }
  if (shuttingDown || !auditLog) {
    closeDb()
    return
  }
  event.preventDefault()
  shuttingDown = true
  void auditLog
    .append({ type: 'app.shutdown', actor: 'system', payload: {} })
    .catch((error) => console.error('Failed to record shutdown event:', error))
    .finally(() => {
      closeDb()
      app.quit()
    })
})
