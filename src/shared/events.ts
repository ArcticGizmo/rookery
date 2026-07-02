/**
 * Append-only audit/event log types. The discriminated union grows as later
 * phases add behavior (spec edits, agent lifecycle, gates, transitions).
 */

export type EventActor = 'system' | 'human' | 'agent'

export type AppEvent =
  | { type: 'app.booted'; actor: 'system'; payload: { version: string; platform: string } }
  | { type: 'app.shutdown'; actor: 'system'; payload: Record<string, never> }
  // Phase 2 — work items, spec versioning, workflow definitions.
  | { type: 'workitem.created'; actor: 'human'; payload: { workItemId: string; title: string } }
  | { type: 'workitem.updated'; actor: 'human'; payload: { workItemId: string; title: string } }
  | { type: 'workitem.deleted'; actor: 'human'; payload: { workItemId: string } }
  | {
      type: 'spec.version_created'
      actor: 'human'
      payload: { workItemId: string; version: number; contentHash: string }
    }
  | {
      type: 'workflow.created'
      actor: 'human'
      payload: { workflowId: string; name: string; version: number }
    }
  | {
      type: 'workflow.updated'
      actor: 'human'
      payload: { workflowId: string; name: string; version: number }
    }
  | { type: 'workflow.deleted'; actor: 'human'; payload: { workflowId: string } }
  // Phase 3 — single-agent runs (Claude Agent SDK).
  | {
      type: 'agent.spawned'
      actor: 'agent'
      payload: { agentRunId: string; personaName: string; model: string; cwd: string | null }
    }
  | { type: 'agent.message'; actor: 'agent'; payload: { agentRunId: string; text: string } }
  | {
      type: 'agent.tool_use'
      actor: 'agent'
      payload: { agentRunId: string; toolUseId: string; toolName: string; input: unknown }
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
  // Phase 4 — orchestration runs.
  | {
      type: 'run.created'
      actor: 'human'
      payload: { runId: string; workItemId: string; workflowId: string; workflowVersion: number }
    }
  | { type: 'run.started'; actor: 'system'; payload: { runId: string } }
  | {
      type: 'run.stage_entered'
      actor: 'system'
      payload: {
        runId: string
        stageId: string
        stageName: string
        stageIndex: number
        iteration: number
      }
    }
  | {
      type: 'run.stage_passed'
      actor: 'system'
      payload: { runId: string; stageId: string; stageIndex: number }
    }
  | {
      type: 'run.stage_failed'
      actor: 'system'
      payload: { runId: string; stageId: string; stageIndex: number; reason: string }
    }
  | {
      type: 'run.criterion_evaluated'
      actor: 'system'
      payload: {
        runId: string
        stageId: string
        criterionId: string
        criterionType: string
        passed: boolean
        detail: string
      }
    }
  | {
      type: 'run.gate_awaiting'
      actor: 'system'
      payload: { runId: string; stageId: string; gateId: string; description: string }
    }
  | {
      type: 'run.gate_resolved'
      actor: 'human'
      payload: { runId: string; stageId: string; decision: string; by: string; note: string }
    }
  | {
      type: 'run.changes_requested'
      actor: 'human'
      payload: { runId: string; targetStageIndex: number; by: string; note: string }
    }
  | { type: 'run.finished'; actor: 'system'; payload: { runId: string; status: string } }
  // Phase 5 — infrastructure (worktrees + docker via InfraProvider / sprig).
  | {
      type: 'infra.provisioning'
      actor: 'system'
      payload: { runId: string; provider: string; instanceName: string; template: string }
    }
  | {
      type: 'infra.up'
      actor: 'system'
      payload: {
        runId: string
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
      payload: { runId: string; provider: string; instanceName: string; removed: boolean }
    }
  | {
      type: 'infra.failed'
      actor: 'system'
      payload: { runId: string; provider: string; instanceName: string; message: string }
    }

/** Optional scoping fields common to every appended event. */
export interface EventScope {
  runId?: string | null
  stageId?: string | null
}

/** A persisted event as read back from the log. `id` is the monotonic sequence. */
export interface StoredEvent {
  id: number
  ts: string
  type: AppEvent['type']
  actor: EventActor
  runId: string | null
  stageId: string | null
  payload: unknown
}

export interface ListEventsOptions {
  /** Return only events with `id` greater than this (for incremental sync). */
  afterId?: number
  /** Maximum number of rows to return (default 500). */
  limit?: number
}
