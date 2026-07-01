import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ListEventsOptions } from '@shared/events'
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkflowDefBody } from '@shared/domain'
import type { AuditLog } from '../services/audit-log'
import type { SpecService } from '../services/spec-service'
import type { WorkItemService } from '../services/work-item-service'
import type { WorkflowService } from '../services/workflow-service'

export interface IpcServices {
  auditLog: AuditLog
  workItems: WorkItemService
  specs: SpecService
  workflows: WorkflowService
}

/** Register request/response handlers and wire event-log push to all windows. */
export function registerIpc(services: IpcServices): void {
  const { auditLog, workItems, specs, workflows } = services

  ipcMain.handle(IPC.appPing, () => 'pong')

  ipcMain.handle(IPC.eventsList, (_event, options: ListEventsOptions | undefined) =>
    auditLog.list(options)
  )

  // Work items
  ipcMain.handle(IPC.workItemsList, () => workItems.list())
  ipcMain.handle(IPC.workItemsGet, (_event, id: string) => workItems.get(id))
  ipcMain.handle(IPC.workItemsCreate, (_event, input: CreateWorkItemInput) =>
    workItems.create(input)
  )
  ipcMain.handle(IPC.workItemsUpdate, (_event, id: string, input: UpdateWorkItemInput) =>
    workItems.update(id, input)
  )
  ipcMain.handle(IPC.workItemsDelete, (_event, id: string) => workItems.delete(id))

  // Spec versioning
  ipcMain.handle(IPC.specSave, (_event, workItemId: string, content: string) =>
    specs.saveSpec(workItemId, content)
  )
  ipcMain.handle(IPC.specHistory, (_event, workItemId: string) => specs.history(workItemId))
  ipcMain.handle(
    IPC.specDiff,
    (_event, workItemId: string, fromVersion: number, toVersion: number) =>
      specs.diff(workItemId, fromVersion, toVersion)
  )

  // Workflow definitions
  ipcMain.handle(IPC.workflowsList, () => workflows.list())
  ipcMain.handle(IPC.workflowsGet, (_event, id: string) => workflows.get(id))
  ipcMain.handle(IPC.workflowsCreate, (_event, input: WorkflowDefBody) => workflows.create(input))
  ipcMain.handle(IPC.workflowsUpdate, (_event, id: string, input: WorkflowDefBody) =>
    workflows.update(id, input)
  )
  ipcMain.handle(IPC.workflowsDelete, (_event, id: string) => workflows.delete(id))

  auditLog.onAppend((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.eventsAppend, event)
    }
  })
}
