import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ListEventsOptions } from '@shared/events'
import type { AuditLog } from '../services/audit-log'

/** Register request/response handlers and wire event-log push to all windows. */
export function registerIpc(auditLog: AuditLog): void {
  ipcMain.handle(IPC.appPing, () => 'pong')

  ipcMain.handle(IPC.eventsList, (_event, options: ListEventsOptions | undefined) =>
    auditLog.list(options)
  )

  auditLog.onAppend((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.eventsAppend, event)
    }
  })
}
