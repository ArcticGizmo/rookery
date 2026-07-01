import type { ListEventsOptions, StoredEvent } from './events'
import type {
  AgentRunConfig,
  CreateWorkItemInput,
  CredentialStatus,
  GateActionInput,
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
  }
}
