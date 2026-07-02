import type { ListEventsOptions, StoredEvent } from './events'
import type { RunInfra } from './infra'
import type { LandingResult, LandingTargets } from './landing'
import type {
  AgentRunConfig,
  CreateWorkItemInput,
  CredentialStatus,
  GateActionInput,
  LandRunInput,
  Run,
  RunDetail,
  SpecDiff,
  SpecVersion,
  StartRunInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemDetail,
  WorkflowDef,
  WorkflowDefBody
} from './domain'

/**
 * Central registry of IPC channel names. All main<->renderer traffic references
 * these constants — no magic channel strings scattered through the codebase.
 */
export const IPC = {
  appPing: 'app:ping',
  eventsList: 'events:list',
  eventsAppend: 'events:append',
  // Work items + spec versioning
  workItemsList: 'work-items:list',
  workItemsGet: 'work-items:get',
  workItemsCreate: 'work-items:create',
  workItemsUpdate: 'work-items:update',
  workItemsDelete: 'work-items:delete',
  specSave: 'spec:save',
  specHistory: 'spec:history',
  specDiff: 'spec:diff',
  // Workflow definitions
  workflowsList: 'workflows:list',
  workflowsGet: 'workflows:get',
  workflowsCreate: 'workflows:create',
  workflowsUpdate: 'workflows:update',
  workflowsDelete: 'workflows:delete',
  // Single-agent runs
  agentCredentials: 'agent:credentials',
  agentStart: 'agent:start',
  agentCancel: 'agent:cancel',
  // Orchestration runs
  runsStart: 'runs:start',
  runsList: 'runs:list',
  runsGet: 'runs:get',
  runsGate: 'runs:gate',
  runsInfra: 'runs:infra',
  runsLandTargets: 'runs:land-targets',
  runsLand: 'runs:land',
  runsTeardown: 'runs:teardown'
} as const

/** Request/response channels: renderer invokes, main handles. */
export interface IpcInvokeMap {
  'app:ping': { args: []; result: string }
  'events:list': { args: [options: ListEventsOptions | undefined]; result: StoredEvent[] }

  'work-items:list': { args: []; result: WorkItem[] }
  'work-items:get': { args: [id: string]; result: WorkItemDetail | null }
  'work-items:create': { args: [input: CreateWorkItemInput]; result: WorkItemDetail }
  'work-items:update': { args: [id: string, input: UpdateWorkItemInput]; result: WorkItemDetail }
  'work-items:delete': { args: [id: string]; result: void }

  'spec:save': { args: [workItemId: string, content: string]; result: SpecVersion }
  'spec:history': { args: [workItemId: string]; result: SpecVersion[] }
  'spec:diff': {
    args: [workItemId: string, fromVersion: number, toVersion: number]
    result: SpecDiff
  }

  'workflows:list': { args: []; result: WorkflowDef[] }
  'workflows:get': { args: [id: string]; result: WorkflowDef | null }
  'workflows:create': { args: [input: WorkflowDefBody]; result: WorkflowDef }
  'workflows:update': { args: [id: string, input: WorkflowDefBody]; result: WorkflowDef }
  'workflows:delete': { args: [id: string]; result: void }

  'agent:credentials': { args: []; result: CredentialStatus }
  'agent:start': { args: [config: AgentRunConfig]; result: { agentRunId: string } }
  'agent:cancel': { args: [agentRunId: string]; result: void }

  'runs:start': { args: [input: StartRunInput]; result: Run }
  'runs:list': { args: []; result: Run[] }
  'runs:get': { args: [runId: string]; result: RunDetail | null }
  'runs:gate': { args: [input: GateActionInput]; result: void }
  'runs:infra': { args: [runId: string]; result: RunInfra }
  'runs:land-targets': { args: [runId: string]; result: LandingTargets }
  'runs:land': { args: [input: LandRunInput]; result: LandingResult }
  'runs:teardown': { args: [runId: string]; result: void }
}

/** Push channels: main sends, renderer listens. */
export interface IpcPushMap {
  'events:append': StoredEvent
}
