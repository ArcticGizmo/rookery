/**
 * Cross-run activity projection (Phase 6.1). Pure and derived entirely from the
 * event log — the dashboard reads this, it never invents state the log doesn't
 * record. Answers "who is doing what and why, right now" across every run,
 * including aggregate context pressure.
 */

import { type PressureLevel, levelForPercent } from './context-pressure'
import type { StoredEvent } from './events'

export interface ActiveAgent {
  agentRunId: string
  personaName: string
  model: string
  /** Owning run/stage (null for standalone single-agent runs). */
  runId: string | null
  stageId: string | null
  contextPercent: number
  contextLevel: PressureLevel
  /** Most recent activity for this agent (label + timestamp). */
  lastActivity: string
  lastActivityTs: string
}

export interface ActiveRun {
  runId: string
  status: 'running' | 'awaiting_gate'
  currentStageName: string | null
  agentCount: number
  updatedTs: string
}

export interface ActivitySummary {
  runs: ActiveRun[]
  agents: ActiveAgent[]
  /** Highest context-usage percent across active agents (0 when none). */
  maxContextPercent: number
  /** Aggregate pressure level derived from `maxContextPercent`. */
  pressureLevel: PressureLevel
  warnCount: number
  highCount: number
}

interface AgentAcc extends ActiveAgent {
  finished: boolean
}

interface RunAcc {
  runId: string
  status: 'running' | 'awaiting_gate'
  currentStageName: string | null
  finished: boolean
  updatedTs: string
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

/** Short human label for an agent's most recent event. */
function activityLabel(event: StoredEvent): string {
  const p = payloadOf(event)
  switch (event.type) {
    case 'agent.spawned':
      return 'spawned'
    case 'agent.message':
      return 'thinking'
    case 'agent.tool_use':
      return `tool: ${String(p.toolName ?? '')}`
    case 'agent.tool_result':
      return p.isError ? 'tool error' : 'tool result'
    case 'agent.permission_denied':
      return `denied ${String(p.toolName ?? '')}`
    case 'agent.task':
      return `task ${String(p.phase ?? '')}`
    case 'agent.usage':
    case 'agent.context_pressure':
      return 'working'
    default:
      return event.type
  }
}

/** Reduce the event log to the set of currently-active runs and agents. */
export function computeActivity(events: StoredEvent[]): ActivitySummary {
  const runs = new Map<string, RunAcc>()
  const agents = new Map<string, AgentAcc>()

  for (const event of events) {
    // --- Runs ---
    if (event.runId && event.type.startsWith('run.')) {
      const p = payloadOf(event)
      const run = runs.get(event.runId) ?? {
        runId: event.runId,
        status: 'running' as const,
        currentStageName: null,
        finished: false,
        updatedTs: event.ts
      }
      run.updatedTs = event.ts
      switch (event.type) {
        case 'run.started':
          run.status = 'running'
          run.finished = false
          break
        case 'run.stage_entered':
          run.status = 'running'
          run.currentStageName = String(p.stageName ?? run.currentStageName ?? '')
          break
        case 'run.gate_awaiting':
          run.status = 'awaiting_gate'
          break
        case 'run.gate_resolved':
        case 'run.stage_passed':
          run.status = 'running'
          break
        case 'run.finished':
          run.finished = true
          break
      }
      runs.set(event.runId, run)
    }

    // --- Agents ---
    if (event.type.startsWith('agent.')) {
      const p = payloadOf(event)
      const agentRunId = String(p.agentRunId ?? '')
      if (!agentRunId) continue

      if (event.type === 'agent.spawned') {
        agents.set(agentRunId, {
          agentRunId,
          personaName: String(p.personaName ?? 'agent'),
          model: String(p.model ?? 'default'),
          runId: event.runId,
          stageId: event.stageId,
          contextPercent: 0,
          contextLevel: 'ok',
          lastActivity: 'spawned',
          lastActivityTs: event.ts,
          finished: false
        })
        continue
      }

      const agent = agents.get(agentRunId)
      if (!agent) continue
      agent.lastActivity = activityLabel(event)
      agent.lastActivityTs = event.ts
      if (event.type === 'agent.context_pressure') {
        agent.contextPercent = Number(p.percent ?? agent.contextPercent)
        agent.contextLevel = levelForPercent(agent.contextPercent)
      } else if (
        event.type === 'agent.finished' ||
        event.type === 'agent.error' ||
        event.type === 'agent.cancelled'
      ) {
        agent.finished = true
      }
    }
  }

  const activeAgents: ActiveAgent[] = [...agents.values()]
    .filter((a) => !a.finished)
    .map((a) => ({
      agentRunId: a.agentRunId,
      personaName: a.personaName,
      model: a.model,
      runId: a.runId,
      stageId: a.stageId,
      contextPercent: a.contextPercent,
      contextLevel: a.contextLevel,
      lastActivity: a.lastActivity,
      lastActivityTs: a.lastActivityTs
    }))
    .sort((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))

  const activeRuns: ActiveRun[] = [...runs.values()]
    .filter((r) => !r.finished)
    .map((r) => ({
      runId: r.runId,
      status: r.status,
      currentStageName: r.currentStageName,
      agentCount: activeAgents.filter((a) => a.runId === r.runId).length,
      updatedTs: r.updatedTs
    }))
    .sort((a, b) => (a.updatedTs < b.updatedTs ? 1 : -1))

  const maxContextPercent = activeAgents.reduce((max, a) => Math.max(max, a.contextPercent), 0)

  return {
    runs: activeRuns,
    agents: activeAgents,
    maxContextPercent,
    pressureLevel: activeAgents.length ? levelForPercent(maxContextPercent) : 'ok',
    warnCount: activeAgents.filter((a) => a.contextLevel === 'warn').length,
    highCount: activeAgents.filter((a) => a.contextLevel === 'high').length
  }
}
