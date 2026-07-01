import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { closeDb, initDb } from './db'
import { runMigrations } from './db/migrate'
import { registerIpc } from './ipc'
import { AuditLog } from './services/audit-log'
import { SqliteEventStore } from './services/sqlite-event-store'

let auditLog: AuditLog | null = null
let shuttingDown = false

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
  const db = initDb(join(app.getPath('userData'), 'rookery.db'))
  await runMigrations(db)

  auditLog = new AuditLog(new SqliteEventStore(db))
  registerIpc(auditLog)

  await auditLog.append({
    type: 'app.booted',
    actor: 'system',
    payload: { version: app.getVersion(), platform: process.platform }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

void app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Record a shutdown event before quitting, then close the database.
app.on('before-quit', (event) => {
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
