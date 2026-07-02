import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ListEventsOptions } from '@shared/events'
import type {
  AgentRunConfig,
  CreateWorkItemInput,
  GateActionInput,
  LandRunInput,
  StartRunInput,
  UpdateWorkItemInput,
  WorkflowDefBody
} from '@shared/domain'
import type { RunEngine } from '../engine/run-engine'
import type { AgentService } from '../services/agent-service'
import type { AuditLog } from '../services/audit-log'
import type { LandingService } from '../services/landing-service'
import type { RunStore } from '../services/run-store'
import type { SpecService } from '../services/spec-service'
import type { WorkItemService } from '../services/work-item-service'
import type { WorkflowService } from '../services/workflow-service'

export interface IpcServices {
  auditLog: AuditLog
  workItems: WorkItemService
  specs: SpecService
  workflows: WorkflowService
  agent: AgentService
  runs: RunStore
  engine: RunEngine
  landing: LandingService
}

/** Register request/response handlers and wire event-log push to all windows. */
export function registerIpc(services: IpcServices): void {
  const { auditLog, workItems, specs, workflows, agent, runs, engine, landing } = services

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

  // Single-agent runs
  ipcMain.handle(IPC.agentCredentials, () => agent.credentials())
  ipcMain.handle(IPC.agentStart, (_event, config: AgentRunConfig) => agent.start(config))
  ipcMain.handle(IPC.agentCancel, (_event, agentRunId: string) => agent.cancel(agentRunId))

  // Orchestration runs
  ipcMain.handle(IPC.runsStart, (_event, input: StartRunInput) => engine.start(input))
  ipcMain.handle(IPC.runsList, () => runs.list())
  ipcMain.handle(IPC.runsGet, (_event, runId: string) => runs.getDetail(runId))
  ipcMain.handle(IPC.runsGate, (_event, input: GateActionInput) => engine.resolveGate(input))
  ipcMain.handle(IPC.runsInfra, (_event, runId: string) => engine.runInfra(runId))
  ipcMain.handle(IPC.runsLandTargets, (_event, runId: string) => landing.targets(runId))
  ipcMain.handle(IPC.runsLand, (_event, input: LandRunInput) => landing.land(input))
  ipcMain.handle(IPC.runsTeardown, (_event, runId: string) => engine.teardownInfra(runId))

  auditLog.onAppend((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.eventsAppend, event)
    }
  })
}
