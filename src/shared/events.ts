/**
 * Append-only audit/event log types. The discriminated union grows as later
 * phases add behavior (spec edits, agent lifecycle, checkpoints, transitions).
 */

export type EventActor = 'system' | 'human' | 'agent'

export type AppEvent =
  | { type: 'app.booted'; actor: 'system'; payload: { version: string; platform: string } }
  | { type: 'app.shutdown'; actor: 'system'; payload: Record<string, never> }
  // Phase 7.3 — auto-update (electron-updater against GitHub Releases). Only the
  // meaningful, attention-worthy states are logged; routine checks are not.
  | { type: 'app.update_available'; actor: 'system'; payload: { version: string } }
  | { type: 'app.update_downloaded'; actor: 'system'; payload: { version: string } }
  | { type: 'app.update_error'; actor: 'system'; payload: { message: string } }
  // Phase 2 — work items, spec versioning, approach definitions.
  | { type: 'brief.created'; actor: 'human'; payload: { briefId: string; title: string } }
  | { type: 'brief.updated'; actor: 'human'; payload: { briefId: string; title: string } }
  | { type: 'brief.deleted'; actor: 'human'; payload: { briefId: string } }
  | {
      type: 'spec.version_created'
      actor: 'human'
      payload: { briefId: string; version: number; contentHash: string }
    }
  | {
      type: 'approach.created'
      actor: 'human'
      payload: { approachId: string; name: string; version: number }
    }
  | {
      type: 'approach.updated'
      actor: 'human'
      payload: { approachId: string; name: string; version: number }
    }
  | { type: 'approach.deleted'; actor: 'human'; payload: { approachId: string } }
  // Phase 3 — single-agent flights (Claude Agent SDK).
  | {
      type: 'agent.spawned'
      actor: 'agent'
      payload: { agentRunId: string; personaName: string; model: string; cwd: string | null }
    }
  | {
      type: 'agent.message'
      actor: 'agent'
      payload: {
        agentRunId: string
        text: string
        /** Set when this text came from a subagent (the parent Task tool_use id). */
        parentToolUseId?: string | null
        /** Subagent type (e.g. 'code-reviewer') when produced inside a subagent. */
        subagentType?: string | null
      }
    }
  | {
      type: 'agent.tool_use'
      actor: 'agent'
      payload: {
        agentRunId: string
        toolUseId: string
        toolName: string
        input: unknown
        parentToolUseId?: string | null
        subagentType?: string | null
      }
    }
  | {
      type: 'agent.tool_result'
      actor: 'agent'
      payload: {
        agentRunId: string
        toolUseId: string
        isError: boolean
        content: string
        parentToolUseId?: string | null
      }
    }
  | {
      type: 'agent.permission_denied'
      actor: 'agent'
      payload: {
        agentRunId: string
        toolName: string
        toolUseId: string
        reason: string
        /** Subagent id when the denied call originated inside a subagent. */
        subagentId?: string | null
      }
    }
  | {
      type: 'agent.task'
      actor: 'agent'
      payload: {
        agentRunId: string
        taskId: string
        phase: 'started' | 'progress' | 'completed' | 'failed' | 'stopped'
        summary: string
        subagentType?: string | null
        toolUseId?: string | null
      }
    }
  | {
      type: 'agent.usage'
      actor: 'agent'
      payload: {
        agentRunId: string
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheCreationTokens: number
      }
    }
  | {
      type: 'agent.context_pressure'
      actor: 'agent'
      payload: {
        agentRunId: string
        usedTokens: number
        contextWindow: number
        percent: number
        level: 'ok' | 'warn' | 'high'
      }
    }
  | {
      type: 'agent.finished'
      actor: 'agent'
      payload: {
        agentRunId: string
        subtype: string
        isError: boolean
        numTurns: number
        totalCostUsd: number | null
        stopReason: string | null
      }
    }
  | { type: 'agent.error'; actor: 'agent'; payload: { agentRunId: string; message: string } }
  | { type: 'agent.cancelled'; actor: 'human'; payload: { agentRunId: string } }
  // Phase 4 — orchestration flights.
  | {
      type: 'flight.created'
      actor: 'human'
      payload: { flightId: string; briefId: string; approachId: string; approachVersion: number }
    }
  | { type: 'flight.started'; actor: 'system'; payload: { flightId: string } }
  | {
      type: 'flight.stage_entered'
      actor: 'system'
      payload: {
        flightId: string
        stageId: string
        stageName: string
        stageIndex: number
        iteration: number
      }
    }
  | {
      type: 'flight.stage_passed'
      actor: 'system'
      payload: { flightId: string; stageId: string; stageIndex: number }
    }
  | {
      type: 'flight.stage_failed'
      actor: 'system'
      payload: { flightId: string; stageId: string; stageIndex: number; reason: string }
    }
  | {
      type: 'flight.criterion_evaluated'
      actor: 'system'
      payload: {
        flightId: string
        stageId: string
        criterionId: string
        criterionType: string
        passed: boolean
        detail: string
      }
    }
  // The consolidated artifact a stage's persona produced this iteration — what a
  // human reviews at the stage's checkpoint (rendered as markdown in the run view).
  | {
      type: 'flight.stage_output'
      actor: 'agent'
      payload: {
        flightId: string
        stageId: string
        stageIndex: number
        personaId: string
        personaName: string
        role: string
        iteration: number
        artifact: string
      }
    }
  | {
      type: 'flight.checkpoint_awaiting'
      actor: 'system'
      payload: { flightId: string; stageId: string; checkpointId: string; description: string }
    }
  | {
      type: 'flight.checkpoint_resolved'
      actor: 'human'
      payload: { flightId: string; stageId: string; decision: string; by: string; note: string }
    }
  | {
      type: 'flight.changes_requested'
      actor: 'human'
      payload: { flightId: string; targetStageIndex: number; by: string; note: string }
    }
  // Phase 6.3 — feature-verification stage: issues found end-to-end.
  | {
      type: 'flight.verification_failed'
      actor: 'system'
      payload: {
        flightId: string
        stageId: string
        stageIndex: number
        /** Human-readable issues found, from the stage's failed pass criteria. */
        issues: string
        /** 1-based failure number within the current (post-intervention) budget. */
        cycle: number
        /** Automatic route-backs allowed before escalation. */
        maxCycles: number
        /** true ⇒ auto-routed back to the first stage; false ⇒ escalated to a human. */
        routedBack: boolean
      }
    }
  | { type: 'flight.finished'; actor: 'system'; payload: { flightId: string; status: string } }
  // A human terminated an in-flight run from the run view (records intent; the
  // engine then cancels live agents and emits `run.finished` with `cancelled`).
  | {
      type: 'flight.cancelled'
      actor: 'human'
      payload: { flightId: string; previousStatus: string }
    }
  // Local-branch execution mode: the setup stage checked out a branch on the
  // work item's own repo checkout so agents can edit without sprig/Docker.
  | {
      type: 'flight.branch_ready'
      actor: 'system'
      payload: { flightId: string; repo: string; branch: string; path: string }
    }
  | {
      type: 'flight.branch_failed'
      actor: 'system'
      payload: { flightId: string; repo: string; branch: string; message: string }
    }
  // Phase 7.1 — a run left mid-flight by a crash/unclean shutdown, reconciled on boot.
  | {
      type: 'flight.interrupted'
      actor: 'system'
      payload: { flightId: string; previousStatus: string; reason: string }
    }
  // Phase 6.4 — landing changes: how a successful run's change reaches main.
  | {
      type: 'flight.landing_started'
      actor: 'human'
      payload: { flightId: string; repo: string; method: string; by: string }
    }
  | {
      type: 'flight.landed'
      actor: 'human'
      payload: {
        flightId: string
        repo: string
        method: string
        /** PR URL (method `pr`), when reported. */
        prUrl: string | null
        /** Base branch merged into (method `merge`), when known. */
        mergedInto: string | null
        detail: string
        by: string
      }
    }
  | {
      type: 'flight.landing_failed'
      actor: 'system'
      payload: { flightId: string; repo: string; method: string; message: string }
    }
  // Phase 5 — infrastructure (worktrees + docker via InfraProvider / sprig).
  | {
      type: 'infra.provisioning'
      actor: 'system'
      payload: { flightId: string; provider: string; instanceName: string; template: string }
    }
  | {
      type: 'infra.up'
      actor: 'system'
      payload: {
        flightId: string
        provider: string
        instanceName: string
        worktrees: { repo: string; path: string; branch: string | null }[]
        ports: number[]
        containerCount: number
      }
    }
  | {
      type: 'infra.down'
      actor: 'system'
      payload: { flightId: string; provider: string; instanceName: string; removed: boolean }
    }
  | {
      type: 'infra.failed'
      actor: 'system'
      payload: { flightId: string; provider: string; instanceName: string; message: string }
    }

/** Optional scoping fields common to every appended event. */
export interface EventScope {
  flightId?: string | null
  stageId?: string | null
}

/** A persisted event as read back from the log. `id` is the monotonic sequence. */
export interface StoredEvent {
  id: number
  ts: string
  type: AppEvent['type']
  actor: EventActor
  flightId: string | null
  stageId: string | null
  payload: unknown
}

export interface ListEventsOptions {
  /** Return only events with `id` greater than this (for incremental sync). */
  afterId?: number
  /** Return only events with `id` less than this (for paging older history). */
  beforeId?: number
  /** Maximum number of rows to return (default 500). */
  limit?: number
  /** Sort order by id. Defaults to `'asc'` (chronological). */
  order?: 'asc' | 'desc'
  /** Filter to a single run. */
  flightId?: string
  /** Filter to a single stage. */
  stageId?: string
  /** Filter by actor. */
  actor?: EventActor
  /** Prefix match on event type (e.g. `'agent.'` matches every agent event). */
  type?: string
  /** Inclusive lower bound on `ts` (UTC ISO-8601). */
  since?: string
  /** Inclusive upper bound on `ts` (UTC ISO-8601). */
  until?: string
  /** Case-insensitive substring match over the type and serialized payload. */
  search?: string
}
