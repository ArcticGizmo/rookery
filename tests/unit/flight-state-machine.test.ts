import { describe, expect, it } from 'vitest'
import {
  type FlightSnapshot,
  initFlightSnapshot,
  isTerminal,
  reduceFlight
} from '../../src/shared/flight-state-machine'

function threeStages(): FlightSnapshot {
  return initFlightSnapshot(['s0', 's1', 's2'])
}

const statusOf = (snap: FlightSnapshot, i: number) => snap.stages[i]!.status

describe('initFlightSnapshot', () => {
  it('starts pending with all stages pending', () => {
    const s = threeStages()
    expect(s.status).toBe('pending')
    expect(s.currentStageIndex).toBe(0)
    expect(s.stages.map((x) => x.status)).toEqual(['pending', 'pending', 'pending'])
  })
})

describe('START', () => {
  it('flights the first stage', () => {
    const s = reduceFlight(threeStages(), { type: 'START' })
    expect(s.status).toBe('running')
    expect(statusOf(s, 0)).toBe('running')
    expect(s.stages[0]!.iteration).toBe(1)
  })

  it('passes immediately when there are no stages', () => {
    expect(reduceFlight(initFlightSnapshot([]), { type: 'START' }).status).toBe('passed')
  })

  it('is a no-op when not pending', () => {
    const running = reduceFlight(threeStages(), { type: 'START' })
    expect(reduceFlight(running, { type: 'START' })).toEqual(running)
  })
})

describe('stage advancement', () => {
  it('advances to the next stage on STAGE_PASSED', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'STAGE_PASSED' })
    expect(s.currentStageIndex).toBe(1)
    expect(statusOf(s, 0)).toBe('passed')
    expect(statusOf(s, 1)).toBe('running')
    expect(s.status).toBe('running')
  })

  it('completes the run after the last stage passes', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'STAGE_PASSED' })
    s = reduceFlight(s, { type: 'STAGE_PASSED' })
    s = reduceFlight(s, { type: 'STAGE_PASSED' })
    expect(s.status).toBe('passed')
    expect(s.stages.every((x) => x.status === 'passed')).toBe(true)
  })

  it('fails the run on STAGE_FAILED', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'STAGE_FAILED' })
    expect(s.status).toBe('failed')
    expect(statusOf(s, 0)).toBe('failed')
  })
})

describe('checkpoints', () => {
  it('awaits, then approves and advances', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'GATE_AWAIT' })
    expect(s.status).toBe('awaiting_checkpoint')
    expect(statusOf(s, 0)).toBe('awaiting_checkpoint')
    s = reduceFlight(s, { type: 'GATE_APPROVE' })
    expect(statusOf(s, 0)).toBe('passed')
    expect(statusOf(s, 1)).toBe('running')
  })

  it('fails the run on GATE_REJECT', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'GATE_AWAIT' })
    s = reduceFlight(s, { type: 'GATE_REJECT' })
    expect(s.status).toBe('failed')
  })
})

describe('REQUEST_CHANGES', () => {
  it('routes back to a prior stage and resets later stages', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'STAGE_PASSED' }) // now on stage 1
    s = reduceFlight(s, { type: 'GATE_AWAIT' })
    s = reduceFlight(s, { type: 'REQUEST_CHANGES', targetIndex: 0 })
    expect(s.status).toBe('running')
    expect(s.currentStageIndex).toBe(0)
    expect(statusOf(s, 0)).toBe('running')
    expect(s.stages[0]!.iteration).toBe(2) // re-run
    expect(statusOf(s, 1)).toBe('pending') // reset
  })

  it('ignores an out-of-range target', () => {
    const s = reduceFlight(threeStages(), { type: 'START' })
    expect(reduceFlight(s, { type: 'REQUEST_CHANGES', targetIndex: 9 })).toEqual(s)
  })
})

describe('RETRY', () => {
  it('re-flights the current stage and bumps iteration', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'RETRY' })
    expect(statusOf(s, 0)).toBe('running')
    expect(s.stages[0]!.iteration).toBe(2)
  })
})

describe('CANCEL', () => {
  it('cancels from running and fails the active stage', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'CANCEL' })
    expect(s.status).toBe('cancelled')
    expect(statusOf(s, 0)).toBe('failed')
  })

  it('is a no-op once terminal', () => {
    let s = reduceFlight(initFlightSnapshot([]), { type: 'START' }) // passed
    expect(isTerminal(s.status)).toBe(true)
    s = reduceFlight(s, { type: 'CANCEL' })
    expect(s.status).toBe('passed')
  })
})

describe('terminal guard', () => {
  it('ignores actions after the run finished', () => {
    let s = reduceFlight(threeStages(), { type: 'START' })
    s = reduceFlight(s, { type: 'STAGE_FAILED' })
    expect(reduceFlight(s, { type: 'STAGE_PASSED' })).toEqual(s)
  })
})
