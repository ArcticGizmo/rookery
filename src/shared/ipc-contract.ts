import type { ApproachDraftResult } from './approach-draft'
import type { ListEventsOptions, StoredEvent } from './events'
import type { FlightInfra } from './infra'
import type { FlightChanges } from './changes'
import type { RepoProbe } from './workspace'
import type { LandingResult, LandingTargets } from './landing'
import type {
  AgentRunConfig,
  CreateBriefInput,
  CredentialStatus,
  CheckpointActionInput,
  LandFlightInput,
  Flight,
  FlightDetail,
  SpecDiff,
  SpecVersion,
  StartFlightInput,
  UpdateBriefInput,
  Brief,
  BriefDetail,
  ApproachDef,
  ApproachDefBody
} from './domain'

/**
 * Central registry of IPC channel names. All main<->renderer traffic references
 * these constants — no magic channel strings scattered through the codebase.
 */
export const IPC = {
  appPing: 'app:ping',
  eventsList: 'events:list',
  eventsAppend: 'events:append',
  // Workspace: folder picker, repo probe, directory autocomplete
  dialogPickDirectory: 'dialog:pick-directory',
  repoProbe: 'repo:probe',
  fsListDirs: 'fs:list-dirs',
  // Work items + spec versioning
  briefsList: 'briefs:list',
  briefsGet: 'briefs:get',
  briefsCreate: 'briefs:create',
  briefsUpdate: 'briefs:update',
  briefsDelete: 'briefs:delete',
  specSave: 'spec:save',
  specHistory: 'spec:history',
  specDiff: 'spec:diff',
  // Approach definitions
  approachesList: 'approaches:list',
  approachesGet: 'approaches:get',
  approachesCreate: 'approaches:create',
  approachesUpdate: 'approaches:update',
  approachesDelete: 'approaches:delete',
  approachesDraft: 'approaches:draft',
  // Single-agent flights
  agentCredentials: 'agent:credentials',
  agentStart: 'agent:start',
  agentCancel: 'agent:cancel',
  // Orchestration flights
  runsStart: 'flights:start',
  runsList: 'flights:list',
  runsGet: 'flights:get',
  runsCheckpoint: 'flights:checkpoint',
  runsCancel: 'flights:cancel',
  runsInfra: 'flights:infra',
  runsChanges: 'flights:changes',
  runsLandTargets: 'flights:land-targets',
  runsLand: 'flights:land',
  runsTeardown: 'flights:teardown',
  // Auto-update
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  // Debug tooling (dev builds only)
  debugResetData: 'debug:reset-data'
} as const

/** Request/response channels: renderer invokes, main handles. */
export interface IpcInvokeMap {
  'app:ping': { args: []; result: string }
  'events:list': { args: [options: ListEventsOptions | undefined]; result: StoredEvent[] }

  'dialog:pick-directory': { args: [defaultPath: string | undefined]; result: string | null }
  'repo:probe': { args: [localPath: string]; result: RepoProbe }
  'fs:list-dirs': { args: [input: string]; result: string[] }

  'briefs:list': { args: []; result: Brief[] }
  'briefs:get': { args: [id: string]; result: BriefDetail | null }
  'briefs:create': { args: [input: CreateBriefInput]; result: BriefDetail }
  'briefs:update': { args: [id: string, input: UpdateBriefInput]; result: BriefDetail }
  'briefs:delete': { args: [id: string]; result: void }

  'spec:save': { args: [briefId: string, content: string]; result: SpecVersion }
  'spec:history': { args: [briefId: string]; result: SpecVersion[] }
  'spec:diff': {
    args: [briefId: string, fromVersion: number, toVersion: number]
    result: SpecDiff
  }

  'approaches:list': { args: []; result: ApproachDef[] }
  'approaches:get': { args: [id: string]; result: ApproachDef | null }
  'approaches:create': { args: [input: ApproachDefBody]; result: ApproachDef }
  'approaches:update': { args: [id: string, input: ApproachDefBody]; result: ApproachDef }
  'approaches:delete': { args: [id: string]; result: void }
  'approaches:draft': { args: [briefId: string]; result: ApproachDraftResult }

  'agent:credentials': { args: []; result: CredentialStatus }
  'agent:start': { args: [config: AgentRunConfig]; result: { agentRunId: string } }
  'agent:cancel': { args: [agentRunId: string]; result: void }

  'flights:start': { args: [input: StartFlightInput]; result: Flight }
  'flights:list': { args: []; result: Flight[] }
  'flights:get': { args: [flightId: string]; result: FlightDetail | null }
  'flights:checkpoint': { args: [input: CheckpointActionInput]; result: void }
  'flights:cancel': { args: [flightId: string]; result: void }
  'flights:infra': { args: [flightId: string]; result: FlightInfra }
  'flights:changes': { args: [flightId: string]; result: FlightChanges }
  'flights:land-targets': { args: [flightId: string]; result: LandingTargets }
  'flights:land': { args: [input: LandFlightInput]; result: LandingResult }
  'flights:teardown': { args: [flightId: string]; result: void }

  'update:check': { args: []; result: void }
  'update:install': { args: []; result: void }

  'debug:reset-data': { args: []; result: void }
}

/** Push channels: main sends, renderer listens. */
export interface IpcPushMap {
  'events:append': StoredEvent
}
