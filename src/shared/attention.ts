/**
 * Attention projection for the journey's two lanes — "In flight" and "Needs you"
 * (Phase J0.3). Pure and derived entirely from the event log, like `activity.ts`:
 * the Desk reads these, it never invents state the log doesn't record.
 *
 * NOTE: this still speaks the current domain vocabulary (run / brief). The
 * great rename (Phase J1) carries these to flight / brief along with everything
 * else; keeping current names here avoids a rename island before J1 lands.
 */

import type { StoredEvent } from './events'

/** A run's lifecycle status as far as the Desk lanes care. */
export type InFlightStatus = 'pending' | 'running' | 'awaiting_checkpoint'

/** One brief currently in flight (a non-terminal run). */
export interface BriefInFlight {
  flightId: string
  briefId: string | null
  status: InFlightStatus
  currentStageName: string | null
  /** True when the flight is paused on a human decision (a held checkpoint or an escalation). */
  needsYou: boolean
  updatedTs: string
}

/** Why a flight needs the human. `checkpoint`/`verification` are decisions; `pressure` is a warning. */
export type AttentionKind = 'checkpoint' | 'verification' | 'pressure'

export interface AttentionItem {
  flightId: string
  kind: AttentionKind
  title: string
  detail: string
  ts: string
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

interface RunAcc {
  flightId: string
  briefId: string | null
  status: InFlightStatus
  currentStageName: string | null
  finished: boolean
  updatedTs: string
  /** Pending human checkpoint, if the run is currently awaiting one. */
  checkpoint: { detail: string; ts: string } | null
  /** Pending verification escalation (route-back budget spent), if any. */
  escalation: { detail: string; ts: string } | null
}

interface AgentAcc {
  flightId: string | null
  level: 'ok' | 'warn' | 'high'
  percent: number
  ts: string
  finished: boolean
}

/** Reduce the event log to per-run accumulators + per-agent pressure. */
function reduce(events: StoredEvent[]): { flights: Map<string, RunAcc>; agents: Map<string, AgentAcc> } {
  const flights = new Map<string, RunAcc>()
  const agents = new Map<string, AgentAcc>()

  for (const event of events) {
    const p = payloadOf(event)

    if (event.flightId && event.type.startsWith('flight.')) {
      const run: RunAcc = flights.get(event.flightId) ?? {
        flightId: event.flightId,
        briefId: null,
        status: 'pending',
        currentStageName: null,
        finished: false,
        updatedTs: event.ts,
        checkpoint: null,
        escalation: null
      }
      run.updatedTs = event.ts
      switch (event.type) {
        case 'flight.created':
          run.briefId = (p.briefId as string) ?? run.briefId
          break
        case 'flight.started':
          run.status = 'running'
          run.finished = false
          break
        case 'flight.stage_entered':
          run.status = 'running'
          run.currentStageName = String(p.stageName ?? run.currentStageName ?? '')
          run.escalation = null
          break
        case 'flight.checkpoint_awaiting':
          run.status = 'awaiting_checkpoint'
          run.checkpoint = { detail: String(p.description ?? ''), ts: event.ts }
          break
        case 'flight.checkpoint_resolved':
        case 'flight.stage_passed':
          run.status = 'running'
          run.checkpoint = null
          break
        case 'flight.verification_failed':
          // Only an escalation (route-back budget spent) needs the human; an
          // auto route-back (routedBack: true) is handled without us.
          if (p.routedBack === false) {
            run.escalation = { detail: String(p.issues ?? ''), ts: event.ts }
          }
          break
        case 'flight.finished':
        case 'flight.cancelled':
        case 'flight.interrupted':
          run.finished = true
          break
      }
      flights.set(event.flightId, run)
    }

    if (event.type.startsWith('agent.')) {
      const agentRunId = String(p.agentRunId ?? '')
      if (!agentRunId) continue
      if (event.type === 'agent.spawned') {
        agents.set(agentRunId, {
          flightId: event.flightId,
          level: 'ok',
          percent: 0,
          ts: event.ts,
          finished: false
        })
        continue
      }
      const agent = agents.get(agentRunId)
      if (!agent) continue
      if (event.type === 'agent.context_pressure') {
        agent.level = (p.level as AgentAcc['level']) ?? agent.level
        agent.percent = Number(p.percent ?? agent.percent)
        agent.ts = event.ts
      } else if (
        event.type === 'agent.finished' ||
        event.type === 'agent.error' ||
        event.type === 'agent.cancelled'
      ) {
        agent.finished = true
      }
    }
  }

  return { flights, agents }
}

function needsYouRun(run: RunAcc): boolean {
  return (run.status === 'awaiting_checkpoint' && run.checkpoint !== null) || run.escalation !== null
}

/** Briefs currently in flight (non-terminal flights), most-recently-active first. */
export function briefsInFlight(events: StoredEvent[]): BriefInFlight[] {
  const { flights } = reduce(events)
  return [...flights.values()]
    .filter((r) => !r.finished)
    .map((r) => ({
      flightId: r.flightId,
      briefId: r.briefId,
      status: r.status,
      currentStageName: r.currentStageName,
      needsYou: needsYouRun(r),
      updatedTs: r.updatedTs
    }))
    .sort((a, b) => (a.updatedTs < b.updatedTs ? 1 : -1))
}

/**
 * The things that need the human right now, most-recent first: held checkpoints
 * and verification escalations (decisions), plus agents at high context pressure
 * (a warning). Only non-terminal flights are considered.
 */
export function needsYou(events: StoredEvent[]): AttentionItem[] {
  const { flights, agents } = reduce(events)
  const items: AttentionItem[] = []

  for (const run of flights.values()) {
    if (run.finished) continue
    if (run.status === 'awaiting_checkpoint' && run.checkpoint) {
      items.push({
        flightId: run.flightId,
        kind: 'checkpoint',
        title: run.currentStageName ? `Checkpoint · ${run.currentStageName}` : 'Checkpoint',
        detail: run.checkpoint.detail || 'Waiting for your decision.',
        ts: run.checkpoint.ts
      })
    }
    if (run.escalation) {
      items.push({
        flightId: run.flightId,
        kind: 'verification',
        title: 'Verification needs you',
        detail: run.escalation.detail || 'Verification could not pass on its own.',
        ts: run.escalation.ts
      })
    }
  }

  for (const agent of agents.values()) {
    if (agent.finished || agent.level !== 'high' || !agent.flightId) continue
    const run = flights.get(agent.flightId)
    if (!run || run.finished) continue
    items.push({
      flightId: agent.flightId,
      kind: 'pressure',
      title: 'High context pressure',
      detail: `An agent is at ${Math.round(agent.percent)}% of its context window — quality may be degrading.`,
      ts: agent.ts
    })
  }

  return items.sort((a, b) => (a.ts < b.ts ? 1 : -1))
}
