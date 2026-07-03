/**
 * Attention projection for the journey's two lanes — "In flight" and "Needs you"
 * (Phase J0.3). Pure and derived entirely from the event log, like `activity.ts`:
 * the Desk reads these, it never invents state the log doesn't record.
 *
 * NOTE: this still speaks the current domain vocabulary (run / workItem). The
 * great rename (Phase J1) carries these to flight / brief along with everything
 * else; keeping current names here avoids a rename island before J1 lands.
 */

import type { StoredEvent } from './events'

/** A run's lifecycle status as far as the Desk lanes care. */
export type InFlightStatus = 'pending' | 'running' | 'awaiting_gate'

/** One brief currently in flight (a non-terminal run). */
export interface BriefInFlight {
  runId: string
  workItemId: string | null
  status: InFlightStatus
  currentStageName: string | null
  /** True when the flight is paused on a human decision (a held checkpoint or an escalation). */
  needsYou: boolean
  updatedTs: string
}

/** Why a flight needs the human. `checkpoint`/`verification` are decisions; `pressure` is a warning. */
export type AttentionKind = 'checkpoint' | 'verification' | 'pressure'

export interface AttentionItem {
  runId: string
  kind: AttentionKind
  title: string
  detail: string
  ts: string
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

interface RunAcc {
  runId: string
  workItemId: string | null
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
  runId: string | null
  level: 'ok' | 'warn' | 'high'
  percent: number
  ts: string
  finished: boolean
}

/** Reduce the event log to per-run accumulators + per-agent pressure. */
function reduce(events: StoredEvent[]): { runs: Map<string, RunAcc>; agents: Map<string, AgentAcc> } {
  const runs = new Map<string, RunAcc>()
  const agents = new Map<string, AgentAcc>()

  for (const event of events) {
    const p = payloadOf(event)

    if (event.runId && event.type.startsWith('run.')) {
      const run: RunAcc = runs.get(event.runId) ?? {
        runId: event.runId,
        workItemId: null,
        status: 'pending',
        currentStageName: null,
        finished: false,
        updatedTs: event.ts,
        checkpoint: null,
        escalation: null
      }
      run.updatedTs = event.ts
      switch (event.type) {
        case 'run.created':
          run.workItemId = (p.workItemId as string) ?? run.workItemId
          break
        case 'run.started':
          run.status = 'running'
          run.finished = false
          break
        case 'run.stage_entered':
          run.status = 'running'
          run.currentStageName = String(p.stageName ?? run.currentStageName ?? '')
          run.escalation = null
          break
        case 'run.gate_awaiting':
          run.status = 'awaiting_gate'
          run.checkpoint = { detail: String(p.description ?? ''), ts: event.ts }
          break
        case 'run.gate_resolved':
        case 'run.stage_passed':
          run.status = 'running'
          run.checkpoint = null
          break
        case 'run.verification_failed':
          // Only an escalation (route-back budget spent) needs the human; an
          // auto route-back (routedBack: true) is handled without us.
          if (p.routedBack === false) {
            run.escalation = { detail: String(p.issues ?? ''), ts: event.ts }
          }
          break
        case 'run.finished':
        case 'run.cancelled':
        case 'run.interrupted':
          run.finished = true
          break
      }
      runs.set(event.runId, run)
    }

    if (event.type.startsWith('agent.')) {
      const agentRunId = String(p.agentRunId ?? '')
      if (!agentRunId) continue
      if (event.type === 'agent.spawned') {
        agents.set(agentRunId, {
          runId: event.runId,
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

  return { runs, agents }
}

function needsYouRun(run: RunAcc): boolean {
  return (run.status === 'awaiting_gate' && run.checkpoint !== null) || run.escalation !== null
}

/** Briefs currently in flight (non-terminal runs), most-recently-active first. */
export function briefsInFlight(events: StoredEvent[]): BriefInFlight[] {
  const { runs } = reduce(events)
  return [...runs.values()]
    .filter((r) => !r.finished)
    .map((r) => ({
      runId: r.runId,
      workItemId: r.workItemId,
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
 * (a warning). Only non-terminal runs are considered.
 */
export function needsYou(events: StoredEvent[]): AttentionItem[] {
  const { runs, agents } = reduce(events)
  const items: AttentionItem[] = []

  for (const run of runs.values()) {
    if (run.finished) continue
    if (run.status === 'awaiting_gate' && run.checkpoint) {
      items.push({
        runId: run.runId,
        kind: 'checkpoint',
        title: run.currentStageName ? `Checkpoint · ${run.currentStageName}` : 'Checkpoint',
        detail: run.checkpoint.detail || 'Waiting for your decision.',
        ts: run.checkpoint.ts
      })
    }
    if (run.escalation) {
      items.push({
        runId: run.runId,
        kind: 'verification',
        title: 'Verification needs you',
        detail: run.escalation.detail || 'Verification could not pass on its own.',
        ts: run.escalation.ts
      })
    }
  }

  for (const agent of agents.values()) {
    if (agent.finished || agent.level !== 'high' || !agent.runId) continue
    const run = runs.get(agent.runId)
    if (!run || run.finished) continue
    items.push({
      runId: agent.runId,
      kind: 'pressure',
      title: 'High context pressure',
      detail: `An agent is at ${Math.round(agent.percent)}% of its context window — quality may be degrading.`,
      ts: agent.ts
    })
  }

  return items.sort((a, b) => (a.ts < b.ts ? 1 : -1))
}
