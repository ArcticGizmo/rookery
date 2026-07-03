import type { ListEventsOptions, StoredEvent } from './events'
import type { RunInfra } from './infra'
import type { RepoProbe } from './workspace'
import type { LandingResult, LandingTargets } from './landing'
import type {
  AgentRunConfig,
  CreateBriefInput,
  CredentialStatus,
  GateActionInput,
  LandRunInput,
  Run,
  RunDetail,
  SpecDiff,
  SpecVersion,
  StartRunInput,
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
  // Single-agent runs
  agentCredentials: 'agent:credentials',
  agentStart: 'agent:start',
  agentCancel: 'agent:cancel',
  // Orchestration runs
  runsStart: 'runs:start',
  runsList: 'runs:list',
  runsGet: 'runs:get',
  runsGate: 'runs:gate',
  runsCancel: 'runs:cancel',
  runsInfra: 'runs:infra',
  runsLandTargets: 'runs:land-targets',
  runsLand: 'runs:land',
  runsTeardown: 'runs:teardown',
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

  'agent:credentials': { args: []; result: CredentialStatus }
  'agent:start': { args: [config: AgentRunConfig]; result: { agentRunId: string } }
  'agent:cancel': { args: [agentRunId: string]; result: void }

  'runs:start': { args: [input: StartRunInput]; result: Run }
  'runs:list': { args: []; result: Run[] }
  'runs:get': { args: [runId: string]; result: RunDetail | null }
  'runs:gate': { args: [input: GateActionInput]; result: void }
  'runs:cancel': { args: [runId: string]; result: void }
  'runs:infra': { args: [runId: string]; result: RunInfra }
  'runs:land-targets': { args: [runId: string]; result: LandingTargets }
  'runs:land': { args: [input: LandRunInput]; result: LandingResult }
  'runs:teardown': { args: [runId: string]; result: void }

  'update:check': { args: []; result: void }
  'update:install': { args: []; result: void }

  'debug:reset-data': { args: []; result: void }
}

/** Push channels: main sends, renderer listens. */
export interface IpcPushMap {
  'events:append': StoredEvent
}
