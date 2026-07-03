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
  /** Owning run/stage (null for standalone single-agent flights). */
  flightId: string | null
  stageId: string | null
  contextPercent: number
  contextLevel: PressureLevel
  /** Most recent activity for this agent (label + timestamp). */
  lastActivity: string
  lastActivityTs: string
}

export interface ActiveFlight {
  flightId: string
  status: 'running' | 'awaiting_checkpoint'
  currentStageName: string | null
  agentCount: number
  updatedTs: string
}

export interface ActivitySummary {
  flights: ActiveFlight[]
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

interface FlightAcc {
  flightId: string
  status: 'running' | 'awaiting_checkpoint'
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

/** Reduce the event log to the set of currently-active flights and agents. */
export function computeActivity(events: StoredEvent[]): ActivitySummary {
  const flights = new Map<string, FlightAcc>()
  const agents = new Map<string, AgentAcc>()

  for (const event of events) {
    // --- Flights ---
    if (event.flightId && event.type.startsWith('flight.')) {
      const p = payloadOf(event)
      const run = flights.get(event.flightId) ?? {
        flightId: event.flightId,
        status: 'running' as const,
        currentStageName: null,
        finished: false,
        updatedTs: event.ts
      }
      run.updatedTs = event.ts
      switch (event.type) {
        case 'flight.started':
          run.status = 'running'
          run.finished = false
          break
        case 'flight.stage_entered':
          run.status = 'running'
          run.currentStageName = String(p.stageName ?? run.currentStageName ?? '')
          break
        case 'flight.checkpoint_awaiting':
          run.status = 'awaiting_checkpoint'
          break
        case 'flight.checkpoint_resolved':
        case 'flight.stage_passed':
          run.status = 'running'
          break
        case 'flight.finished':
          run.finished = true
          break
      }
      flights.set(event.flightId, run)
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
          flightId: event.flightId,
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
      flightId: a.flightId,
      stageId: a.stageId,
      contextPercent: a.contextPercent,
      contextLevel: a.contextLevel,
      lastActivity: a.lastActivity,
      lastActivityTs: a.lastActivityTs
    }))
    .sort((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))

  const activeFlights: ActiveFlight[] = [...flights.values()]
    .filter((r) => !r.finished)
    .map((r) => ({
      flightId: r.flightId,
      status: r.status,
      currentStageName: r.currentStageName,
      agentCount: activeAgents.filter((a) => a.flightId === r.flightId).length,
      updatedTs: r.updatedTs
    }))
    .sort((a, b) => (a.updatedTs < b.updatedTs ? 1 : -1))

  const maxContextPercent = activeAgents.reduce((max, a) => Math.max(max, a.contextPercent), 0)

  return {
    flights: activeFlights,
    agents: activeAgents,
    maxContextPercent,
    pressureLevel: activeAgents.length ? levelForPercent(maxContextPercent) : 'ok',
    warnCount: activeAgents.filter((a) => a.contextLevel === 'warn').length,
    highCount: activeAgents.filter((a) => a.contextLevel === 'high').length
  }
}
