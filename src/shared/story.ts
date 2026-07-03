/**
 * The story of a change (Phase J9.1). A pure projection over a flight's event
 * log that reads the append-only truth back as a narrative — separating what
 * *you* decided from what the *rooks* did from what the *system* recorded. Like
 * the other attention/activity projections, it invents nothing the log doesn't
 * hold; it only chooses which beats to tell and how to phrase them.
 *
 * The broad story omits the high-frequency agent chatter (individual messages,
 * tool calls, token usage); those are the granular detail a node zooms into
 * (Phase J9.2). Feed it a single flight's events (as `useScopedEvents` provides)
 * and it returns the timeline, oldest-first.
 */

import type { EventActor, StoredEvent } from './events'

/** Which lane a beat belongs to. Mirrors the event actor, told as the journey. */
export type StoryLane = 'you' | 'rooks' | 'system'

export interface StoryNode {
  /** The source event's id — a stable key and the anchor the zoom (J9.2) opens. */
  id: number
  lane: StoryLane
  /** The lane word plus an optional qualifier, e.g. `you · checkpoint`, `verify`. */
  actorLabel: string
  type: StoredEvent['type']
  /** The narrative one-liner ("what"). */
  title: string
  /** An optional secondary line ("sub"); empty when there's nothing to add. */
  detail: string
  ts: string
}

const LANE_OF: Record<EventActor, StoryLane> = {
  human: 'you',
  agent: 'rooks',
  system: 'system'
}

/**
 * The granular agent stream — reserved for the per-node zoom (J9.2), so the
 * broad story stays a readable narrative rather than a wall of tool calls. Also
 * drops the per-criterion evaluations, which `verification_failed` summarizes.
 */
const GRANULAR = new Set<StoredEvent['type']>([
  'agent.message',
  'agent.tool_use',
  'agent.tool_result',
  'agent.usage',
  'agent.context_pressure',
  'agent.task',
  'agent.permission_denied',
  'agent.finished',
  'agent.cancelled',
  'flight.criterion_evaluated'
])

interface Beat {
  actorLabel: string
  title: string
  detail: string
}

/** Phrase one event as a story beat, or null to omit it from the broad story. */
function beatFor(event: StoredEvent): Beat | null {
  const p = (event.payload ?? {}) as Record<string, unknown>
  const s = (v: unknown): string => String(v ?? '')
  switch (event.type) {
    // --- you · decisions ---
    case 'brief.created':
      return { actorLabel: 'you', title: `Commissioned the brief: ${s(p.title)}`, detail: '' }
    case 'spec.version_created':
      return { actorLabel: 'you', title: `Cut spec v${s(p.version)}`, detail: 'Content-hashed and audited' }
    case 'flight.created':
      return { actorLabel: 'you', title: 'Committed the brief to flight', detail: '' }
    case 'flight.checkpoint_resolved': {
      const verb =
        p.decision === 'approve'
          ? 'Approved and continued'
          : p.decision === 'reject'
            ? 'Rejected — the flight stops here'
            : 'Requested changes'
      const note = s(p.note).trim()
      return { actorLabel: `you · checkpoint`, title: `${verb} (by ${s(p.by)})`, detail: note }
    }
    case 'flight.changes_requested':
      return {
        actorLabel: 'you · decision',
        title: `Routed back to an earlier step (by ${s(p.by)})`,
        detail: s(p.note).trim()
      }
    case 'flight.cancelled':
      return { actorLabel: 'you', title: 'Terminated the flight', detail: `was ${s(p.previousStatus)}` }
    case 'flight.landing_started':
      return { actorLabel: 'you · checkpoint', title: `Landing ${s(p.repo)} via ${s(p.method)} (by ${s(p.by)})`, detail: '' }
    case 'flight.landed':
      return {
        actorLabel: 'you · checkpoint',
        title: `Landed ${s(p.repo)} via ${s(p.method)}`,
        detail: p.prUrl ? s(p.prUrl) : p.mergedInto ? `merged into ${s(p.mergedInto)}` : s(p.detail)
      }

    // --- rooks · actions ---
    case 'agent.spawned':
      return { actorLabel: 'rooks', title: `${s(p.personaName)} took the controls`, detail: s(p.model) }
    case 'flight.stage_output':
      return {
        actorLabel: `rook · ${s(p.role)}`,
        title: `${s(p.personaName)} produced its output`,
        detail: ''
      }
    case 'agent.error':
      return { actorLabel: 'rooks', title: 'An agent hit an error', detail: s(p.message) }

    // --- system ---
    case 'flight.started':
      return { actorLabel: 'system', title: 'Flight started', detail: '' }
    case 'flight.stage_entered':
      return {
        actorLabel: 'system',
        title: `Entered ${s(p.stageName)}`,
        detail: Number(p.iteration) > 1 ? `iteration ${s(p.iteration)}` : ''
      }
    case 'flight.stage_passed':
      return { actorLabel: 'system', title: 'Stage passed', detail: '' }
    case 'flight.stage_failed':
      return { actorLabel: 'system', title: 'Stage failed', detail: s(p.reason) }
    case 'flight.verification_failed':
      return {
        actorLabel: 'verify',
        title: p.routedBack
          ? `Verification failed (${s(p.cycle)}/${s(p.maxCycles)}) — looping back`
          : 'Verification failed — escalated to you',
        detail: s(p.issues)
      }
    case 'flight.checkpoint_awaiting':
      return { actorLabel: 'system', title: 'Paused for your checkpoint', detail: s(p.description) }
    case 'flight.finished':
      return { actorLabel: 'system', title: `Flight ${s(p.status)}`, detail: '' }
    case 'flight.interrupted':
      return { actorLabel: 'system', title: 'Flight interrupted', detail: s(p.reason) }
    case 'flight.branch_ready':
      return { actorLabel: 'system', title: `Branch ready: ${s(p.repo)}`, detail: s(p.branch) }
    case 'flight.branch_failed':
      return { actorLabel: 'system', title: `Branch prep failed: ${s(p.repo)}`, detail: s(p.message) }
    case 'flight.landing_failed':
      return { actorLabel: 'system', title: `Landing ${s(p.repo)} failed`, detail: s(p.message) }
    case 'infra.provisioning':
      return { actorLabel: 'system', title: 'Provisioning isolated workspace', detail: s(p.template) }
    case 'infra.up':
      return {
        actorLabel: 'system',
        title: 'Isolated workspace ready',
        detail: `${(p.worktrees as unknown[] | undefined)?.length ?? 0} worktree(s), ${s(p.containerCount)} container(s)`
      }
    case 'infra.down':
      return { actorLabel: 'system', title: p.removed ? 'Workspace torn down' : 'Workspace stopped', detail: '' }
    case 'infra.failed':
      return { actorLabel: 'system', title: 'Workspace failed', detail: s(p.message) }

    default:
      return null
  }
}

/**
 * Reduce a flight's events to its story: an oldest-first timeline of beats, each
 * tagged with its lane and timestamped. Events with no narrative beat (the
 * granular agent stream, unknown types) are omitted from the broad telling.
 */
export function buildStory(events: StoredEvent[]): StoryNode[] {
  const nodes: StoryNode[] = []
  for (const event of events) {
    if (GRANULAR.has(event.type)) continue
    const beat = beatFor(event)
    if (!beat) continue
    nodes.push({
      id: event.id,
      lane: LANE_OF[event.actor],
      actorLabel: beat.actorLabel,
      type: event.type,
      title: beat.title,
      detail: beat.detail,
      ts: event.ts
    })
  }
  return nodes
}
