import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { type Db, resetAllData } from '../db'
import type { ListEventsOptions } from '@shared/events'
import type {
  AgentRunConfig,
  CreateBriefInput,
  GateActionInput,
  LandRunInput,
  StartRunInput,
  UpdateBriefInput,
  WorkflowDefBody
} from '@shared/domain'
import type { RunEngine } from '../engine/run-engine'
import type { AgentService } from '../services/agent-service'
import type { AuditLog } from '../services/audit-log'
import type { LandingService } from '../services/landing-service'
import type { RunStore } from '../services/run-store'
import type { SpecService } from '../services/spec-service'
import type { UpdateService } from '../services/update-service'
import type { BriefService } from '../services/brief-service'
import type { WorkflowService } from '../services/workflow-service'
import type { WorkspaceService } from '../services/workspace-service'

export interface IpcServices {
  db: Db
  auditLog: AuditLog
  briefs: BriefService
  specs: SpecService
  workflows: WorkflowService
  agent: AgentService
  runs: RunStore
  engine: RunEngine
  landing: LandingService
  workspace: WorkspaceService
  /** Optional: absent in contexts without auto-update (e.g. some tests). */
  update?: UpdateService
}

/** Register request/response handlers and wire event-log push to all windows. */
export function registerIpc(services: IpcServices): void {
  const {
    db,
    auditLog,
    briefs,
    specs,
    workflows,
    agent,
    runs,
    engine,
    landing,
    workspace,
    update
  } = services

  ipcMain.handle(IPC.appPing, () => 'pong')

  ipcMain.handle(IPC.eventsList, (_event, options: ListEventsOptions | undefined) =>
    auditLog.list(options)
  )

  // Workspace: folder picker, repo probe, directory autocomplete
  ipcMain.handle(IPC.dialogPickDirectory, (event, defaultPath: string | undefined) =>
    workspace.pickDirectory(BrowserWindow.fromWebContents(event.sender), defaultPath)
  )
  ipcMain.handle(IPC.repoProbe, (_event, localPath: string) => workspace.probeRepo(localPath))
  ipcMain.handle(IPC.fsListDirs, (_event, input: string) => workspace.listDirs(input))

  // Work items
  ipcMain.handle(IPC.briefsList, () => briefs.list())
  ipcMain.handle(IPC.briefsGet, (_event, id: string) => briefs.get(id))
  ipcMain.handle(IPC.briefsCreate, (_event, input: CreateBriefInput) =>
    briefs.create(input)
  )
  ipcMain.handle(IPC.briefsUpdate, (_event, id: string, input: UpdateBriefInput) =>
    briefs.update(id, input)
  )
  ipcMain.handle(IPC.briefsDelete, (_event, id: string) => briefs.delete(id))

  // Spec versioning
  ipcMain.handle(IPC.specSave, (_event, briefId: string, content: string) =>
    specs.saveSpec(briefId, content)
  )
  ipcMain.handle(IPC.specHistory, (_event, briefId: string) => specs.history(briefId))
  ipcMain.handle(
    IPC.specDiff,
    (_event, briefId: string, fromVersion: number, toVersion: number) =>
      specs.diff(briefId, fromVersion, toVersion)
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
  ipcMain.handle(IPC.runsCancel, (_event, runId: string) => engine.cancel(runId))
  ipcMain.handle(IPC.runsInfra, (_event, runId: string) => engine.runInfra(runId))
  ipcMain.handle(IPC.runsLandTargets, (_event, runId: string) => landing.targets(runId))
  ipcMain.handle(IPC.runsLand, (_event, input: LandRunInput) => landing.land(input))
  ipcMain.handle(IPC.runsTeardown, (_event, runId: string) => engine.teardownInfra(runId))

  // Auto-update: no-op when the service isn't wired (e.g. unpackaged dev).
  ipcMain.handle(IPC.updateCheck, () => update?.check())
  ipcMain.handle(IPC.updateInstall, () => update?.install())

  // Debug tooling: cancel any live runs (stopping their agents), then wipe every
  // table. Gated to dev builds in the renderer, which only exposes the button
  // when `import.meta.env.DEV` is set.
  ipcMain.handle(IPC.debugResetData, async () => {
    await engine.cancelAllInFlight()
    await resetAllData(db)
  })

  auditLog.onAppend((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.eventsAppend, event)
    }
  })
}
