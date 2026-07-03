/**
 * Pure run/stage lifecycle reducer (Phase 4.2). No side effects, no I/O — the
 * engine (Phase 4.3) interprets the resulting snapshot to decide what to
 * actually do (spawn agents, halt at checkpoints, persist). Kept in `shared` so both
 * the engine and the UI reason about run state identically.
 *
 * Lifecycle: pending → running → (awaiting_checkpoint) → passed / failed, with
 * `next` (advance) and `back` (request-changes) transitions between stages.
 */

import type { FlightStatus, StageStatus } from './domain'

export interface StageSnapshot {
  stageId: string
  index: number
  status: StageStatus
  /** 1-based; bumps each time the stage (re)flights. */
  iteration: number
}

export interface FlightSnapshot {
  status: FlightStatus
  currentStageIndex: number
  stages: StageSnapshot[]
}

export type FlightAction =
  | { type: 'START' }
  | { type: 'STAGE_PASSED' }
  | { type: 'STAGE_FAILED' }
  | { type: 'GATE_AWAIT' }
  | { type: 'GATE_APPROVE' }
  | { type: 'GATE_REJECT' }
  | { type: 'REQUEST_CHANGES'; targetIndex: number }
  | { type: 'RETRY' }
  | { type: 'CANCEL' }

const TERMINAL: readonly FlightStatus[] = ['passed', 'failed', 'cancelled']

export function isTerminal(status: FlightStatus): boolean {
  return TERMINAL.includes(status)
}

/** Build the initial snapshot for a run over the given ordered stage ids. */
export function initFlightSnapshot(stageIds: string[]): FlightSnapshot {
  return {
    status: 'pending',
    currentStageIndex: 0,
    stages: stageIds.map((stageId, index) => ({
      stageId,
      index,
      status: 'pending',
      iteration: 0
    }))
  }
}

function setStage(
  stages: StageSnapshot[],
  index: number,
  patch: Partial<StageSnapshot>
): StageSnapshot[] {
  return stages.map((stage) => (stage.index === index ? { ...stage, ...patch } : stage))
}

/**
 * Apply an action to a snapshot, returning a new snapshot. Invalid transitions
 * (e.g. STAGE_PASSED on a terminal run) return the snapshot unchanged so callers
 * never crash on a stray action; the engine only issues valid actions.
 */
export function reduceFlight(snapshot: FlightSnapshot, action: FlightAction): FlightSnapshot {
  if (action.type === 'CANCEL') {
    if (isTerminal(snapshot.status)) return snapshot
    const stages = snapshot.stages.map((s) =>
      s.status === 'running' || s.status === 'awaiting_checkpoint'
        ? { ...s, status: 'failed' as const }
        : s
    )
    return { ...snapshot, status: 'cancelled', stages }
  }

  if (isTerminal(snapshot.status)) return snapshot

  switch (action.type) {
    case 'START': {
      if (snapshot.status !== 'pending') return snapshot
      if (snapshot.stages.length === 0) return { ...snapshot, status: 'passed' }
      return {
        status: 'running',
        currentStageIndex: 0,
        stages: setStage(snapshot.stages, 0, { status: 'running', iteration: 1 })
      }
    }

    case 'RETRY': {
      const i = snapshot.currentStageIndex
      const current = snapshot.stages[i]
      if (!current) return snapshot
      return {
        ...snapshot,
        status: 'running',
        stages: setStage(snapshot.stages, i, {
          status: 'running',
          iteration: current.iteration + 1
        })
      }
    }

    case 'GATE_AWAIT': {
      const i = snapshot.currentStageIndex
      return {
        ...snapshot,
        status: 'awaiting_checkpoint',
        stages: setStage(snapshot.stages, i, { status: 'awaiting_checkpoint' })
      }
    }

    case 'STAGE_PASSED':
    case 'GATE_APPROVE': {
      const i = snapshot.currentStageIndex
      const passed = setStage(snapshot.stages, i, { status: 'passed' })
      const isLast = i >= snapshot.stages.length - 1
      if (isLast) {
        return { ...snapshot, status: 'passed', stages: passed }
      }
      const next = i + 1
      return {
        status: 'running',
        currentStageIndex: next,
        stages: setStage(passed, next, { status: 'running', iteration: 1 })
      }
    }

    case 'STAGE_FAILED':
    case 'GATE_REJECT': {
      const i = snapshot.currentStageIndex
      return {
        ...snapshot,
        status: 'failed',
        stages: setStage(snapshot.stages, i, { status: 'failed' })
      }
    }

    case 'REQUEST_CHANGES': {
      const target = action.targetIndex
      if (target < 0 || target >= snapshot.stages.length) return snapshot
      // Reset the target and every stage after it; the target re-flights.
      const stages = snapshot.stages.map((s) => {
        if (s.index < target) return s
        if (s.index === target) {
          return { ...s, status: 'running' as const, iteration: s.iteration + 1 }
        }
        return { ...s, status: 'pending' as const }
      })
      return { status: 'running', currentStageIndex: target, stages }
    }

    default:
      return snapshot
  }
}
