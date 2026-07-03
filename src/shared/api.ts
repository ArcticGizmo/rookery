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
  /** Filesystem/git helpers for attaching repos to a work item. */
  workspace: {
    /** Open the OS folder picker; resolves to the chosen path or null if cancelled. */
    pickDirectory: (defaultPath?: string) => Promise<string | null>
    /** Probe a candidate repo path (existence, git-ness, remote URL, default branch). */
    probeRepo: (localPath: string) => Promise<RepoProbe>
    /** Directory-path autocomplete candidates for a partial path. */
    listDirs: (input: string) => Promise<string[]>
  }
  briefs: {
    list: () => Promise<Brief[]>
    get: (id: string) => Promise<BriefDetail | null>
    create: (input: CreateBriefInput) => Promise<BriefDetail>
    update: (id: string, input: UpdateBriefInput) => Promise<BriefDetail>
    remove: (id: string) => Promise<void>
  }
  spec: {
    /** Persist spec content; a new version is cut only when it changes. */
    save: (briefId: string, content: string) => Promise<SpecVersion>
    history: (briefId: string) => Promise<SpecVersion[]>
    diff: (briefId: string, fromVersion: number, toVersion: number) => Promise<SpecDiff>
  }
  approaches: {
    list: () => Promise<ApproachDef[]>
    get: (id: string) => Promise<ApproachDef | null>
    create: (input: ApproachDefBody) => Promise<ApproachDef>
    update: (id: string, input: ApproachDefBody) => Promise<ApproachDef>
    remove: (id: string) => Promise<void>
    /** Ask an agent to draft an approach from a brief's spec (Phase J4). */
    draft: (briefId: string) => Promise<ApproachDraftResult>
  }
  agent: {
    /** Whether Agent SDK credentials resolve (drives the login banner). */
    credentials: () => Promise<CredentialStatus>
    /** Start a single agent run; its activity streams via `events.onAppend`. */
    start: (config: AgentRunConfig) => Promise<{ agentRunId: string }>
    cancel: (agentRunId: string) => Promise<void>
  }
  flights: {
    /** Start a approach run over a work item; activity streams via `events.onAppend`. */
    start: (input: StartFlightInput) => Promise<Flight>
    list: () => Promise<Flight[]>
    get: (flightId: string) => Promise<FlightDetail | null>
    /** Resolve a pending human checkpoint (approve/reject/request-changes). */
    checkpoint: (input: CheckpointActionInput) => Promise<void>
    /** Terminate an in-flight run: cancels its live agents and marks it cancelled. */
    cancel: (flightId: string) => Promise<void>
    /** Live infrastructure status for a run (instances, worktrees, container health). */
    infra: (flightId: string) => Promise<FlightInfra>
    /** Broad changes summary (files touched, +/-) across the flight's worktrees. */
    changes: (flightId: string) => Promise<FlightChanges>
    /** Which repos of a successful run can be landed (open PR / merge). */
    landTargets: (flightId: string) => Promise<LandingTargets>
    /** Land one impacted repo of a successful run via a PR or a direct merge. */
    land: (input: LandFlightInput) => Promise<LandingResult>
    /** Tear down a run's infrastructure on demand (after landing/dismissal). */
    teardown: (flightId: string) => Promise<void>
  }
  update: {
    /** Ask the update server whether a newer release is available. */
    check: () => Promise<void>
    /** Quit and install a downloaded update (the "restart to update" action). */
    install: () => Promise<void>
  }
  debug: {
    /** Dev-only: delete all persisted data (work items, flights, approaches, events). */
    resetData: () => Promise<void>
  }
}
