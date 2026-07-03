import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { type Db, resetAllData } from '../db'
import type { ListEventsOptions } from '@shared/events'
import type {
  AgentRunConfig,
  CreateBriefInput,
  CheckpointActionInput,
  LandFlightInput,
  StartFlightInput,
  UpdateBriefInput,
  ApproachDefBody
} from '@shared/domain'
import type { FlightEngine } from '../engine/flight-engine'
import type { AgentService } from '../services/agent-service'
import type { AuditLog } from '../services/audit-log'
import type { LandingService } from '../services/landing-service'
import type { ChangesService } from '../services/changes-service'
import type { FlightStore } from '../services/flight-store'
import type { SpecService } from '../services/spec-service'
import type { UpdateService } from '../services/update-service'
import type { BriefService } from '../services/brief-service'
import type { ApproachService } from '../services/approach-service'
import { draftApproachForBrief } from '../services/approach-drafter'
import type { WorkspaceService } from '../services/workspace-service'

export interface IpcServices {
  db: Db
  auditLog: AuditLog
  briefs: BriefService
  specs: SpecService
  approaches: ApproachService
  agent: AgentService
  flights: FlightStore
  engine: FlightEngine
  landing: LandingService
  changes: ChangesService
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
    approaches,
    agent,
    flights,
    engine,
    landing,
    changes,
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

  // Briefs
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

  // Approach definitions
  ipcMain.handle(IPC.approachesList, () => approaches.list())
  ipcMain.handle(IPC.approachesGet, (_event, id: string) => approaches.get(id))
  ipcMain.handle(IPC.approachesCreate, (_event, input: ApproachDefBody) => approaches.create(input))
  ipcMain.handle(IPC.approachesUpdate, (_event, id: string, input: ApproachDefBody) =>
    approaches.update(id, input)
  )
  ipcMain.handle(IPC.approachesDelete, (_event, id: string) => approaches.delete(id))
  ipcMain.handle(IPC.approachesDraft, (_event, briefId: string) =>
    draftApproachForBrief(agent, briefs, briefId)
  )

  // Single-agent flights
  ipcMain.handle(IPC.agentCredentials, () => agent.credentials())
  ipcMain.handle(IPC.agentStart, (_event, config: AgentRunConfig) => agent.start(config))
  ipcMain.handle(IPC.agentCancel, (_event, agentRunId: string) => agent.cancel(agentRunId))

  // Orchestration flights
  ipcMain.handle(IPC.runsStart, (_event, input: StartFlightInput) => engine.start(input))
  ipcMain.handle(IPC.runsList, () => flights.list())
  ipcMain.handle(IPC.runsGet, (_event, flightId: string) => flights.getDetail(flightId))
  ipcMain.handle(IPC.runsCheckpoint, (_event, input: CheckpointActionInput) => engine.resolveCheckpoint(input))
  ipcMain.handle(IPC.runsCancel, (_event, flightId: string) => engine.cancel(flightId))
  ipcMain.handle(IPC.runsInfra, (_event, flightId: string) => engine.flightInfra(flightId))
  ipcMain.handle(IPC.runsChanges, (_event, flightId: string) => changes.changes(flightId))
  ipcMain.handle(IPC.runsLandTargets, (_event, flightId: string) => landing.targets(flightId))
  ipcMain.handle(IPC.runsLand, (_event, input: LandFlightInput) => landing.land(input))
  ipcMain.handle(IPC.runsTeardown, (_event, flightId: string) => engine.teardownInfra(flightId))

  // Auto-update: no-op when the service isn't wired (e.g. unpackaged dev).
  ipcMain.handle(IPC.updateCheck, () => update?.check())
  ipcMain.handle(IPC.updateInstall, () => update?.install())

  // Debug tooling: cancel any live flights (stopping their agents), then wipe every
  // table. Checkpointd to dev builds in the renderer, which only exposes the button
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
