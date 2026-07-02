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
 * The API surface the preload script exposes on `window.rookery`. Both the
 * preload (implementer) and the renderer (consumer) depend on this definition.
 */
export interface RookeryApi {
  /** Liveness check routed through IPC to the main process. */
  ping: () => Promise<string>
  events: {
    /** Fetch persisted events (optionally incremental via `afterId`). */
    list: (options?: ListEventsOptions) => Promise<StoredEvent[]>
    /** Subscribe to events as they are appended. Returns an unsubscribe fn. */
    onAppend: (listener: (event: StoredEvent) => void) => () => void
  }
  workItems: {
    list: () => Promise<WorkItem[]>
    get: (id: string) => Promise<WorkItemDetail | null>
    create: (input: CreateWorkItemInput) => Promise<WorkItemDetail>
    update: (id: string, input: UpdateWorkItemInput) => Promise<WorkItemDetail>
    remove: (id: string) => Promise<void>
  }
  spec: {
    /** Persist spec content; a new version is cut only when it changes. */
    save: (workItemId: string, content: string) => Promise<SpecVersion>
    history: (workItemId: string) => Promise<SpecVersion[]>
    diff: (workItemId: string, fromVersion: number, toVersion: number) => Promise<SpecDiff>
  }
  workflows: {
    list: () => Promise<WorkflowDef[]>
    get: (id: string) => Promise<WorkflowDef | null>
    create: (input: WorkflowDefBody) => Promise<WorkflowDef>
    update: (id: string, input: WorkflowDefBody) => Promise<WorkflowDef>
    remove: (id: string) => Promise<void>
  }
  agent: {
    /** Whether Agent SDK credentials resolve (drives the login banner). */
    credentials: () => Promise<CredentialStatus>
    /** Start a single agent run; its activity streams via `events.onAppend`. */
    start: (config: AgentRunConfig) => Promise<{ agentRunId: string }>
    cancel: (agentRunId: string) => Promise<void>
  }
  runs: {
    /** Start a workflow run over a work item; activity streams via `events.onAppend`. */
    start: (input: StartRunInput) => Promise<Run>
    list: () => Promise<Run[]>
    get: (runId: string) => Promise<RunDetail | null>
    /** Resolve a pending human gate (approve/reject/request-changes). */
    gate: (input: GateActionInput) => Promise<void>
    /** Live infrastructure status for a run (instances, worktrees, container health). */
    infra: (runId: string) => Promise<RunInfra>
    /** Which repos of a successful run can be landed (open PR / merge). */
    landTargets: (runId: string) => Promise<LandingTargets>
    /** Land one impacted repo of a successful run via a PR or a direct merge. */
    land: (input: LandRunInput) => Promise<LandingResult>
    /** Tear down a run's infrastructure on demand (after landing/dismissal). */
    teardown: (runId: string) => Promise<void>
  }
  update: {
    /** Ask the update server whether a newer release is available. */
    check: () => Promise<void>
    /** Quit and install a downloaded update (the "restart to update" action). */
    install: () => Promise<void>
  }
}
