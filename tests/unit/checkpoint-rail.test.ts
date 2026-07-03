import { describe, expect, it } from 'vitest'
import {
  defaultCheckpointDescription,
  setHumanHold,
  stageHolds
} from '../../src/shared/checkpoint-rail'
import { instantiateTemplate, WORKFLOW_TEMPLATES } from '../../src/shared/approach-templates'
import { parseApproachDraft } from '../../src/shared/approach-draft'
import type { Checkpoint, Stage } from '../../src/shared/domain'

const stage = (checkpoints: Checkpoint[]): Stage => ({
  id: 's',
  name: 'S',
  type: 'review',
  personas: [],
  doneCriteria: [],
  checkpoints
})

let counter = 0
const uid = (): string => `id-${counter++}`

describe('stageHolds', () => {
  it('is true iff the stage carries a human checkpoint', () => {
    expect(stageHolds(stage([]))).toBe(false)
    expect(stageHolds(stage([{ id: 'a', kind: 'automated', description: '' }]))).toBe(false)
    expect(stageHolds(stage([{ id: 'h', kind: 'human', description: '' }]))).toBe(true)
  })
})

describe('defaultCheckpointDescription', () => {
  it('phrases a reason per stage type', () => {
    expect(defaultCheckpointDescription('review')).toBe('Approve the review before planning')
    expect(defaultCheckpointDescription('plan')).toBe('Approve the plan before building')
    expect(defaultCheckpointDescription('implementation')).toBe('Approve the implementation')
    expect(defaultCheckpointDescription('verification')).toBe('Confirm the feature is done')
    expect(defaultCheckpointDescription('custom')).toBe('Approve before continuing')
  })
})

describe('setHumanHold', () => {
  it('adds a human checkpoint (with description + fresh id) when holding a stage that has none', () => {
    counter = 0
    const result = setHumanHold([], true, 'Approve it', uid)
    expect(result).toEqual([{ id: 'id-0', kind: 'human', description: 'Approve it' }])
  })

  it('is idempotent — an already-held stage is returned unchanged', () => {
    const existing: Checkpoint[] = [{ id: 'h', kind: 'human', description: 'keep me' }]
    const result = setHumanHold(existing, true, 'ignored', uid)
    expect(result).toBe(existing)
  })

  it('removes human checkpoints when set to auto, preserving automated ones', () => {
    const before: Checkpoint[] = [
      { id: 'h', kind: 'human', description: '' },
      { id: 'a', kind: 'automated', description: 'tests' }
    ]
    const result = setHumanHold(before, false, '', uid)
    expect(result).toEqual([{ id: 'a', kind: 'automated', description: 'tests' }])
  })

  it('does not mutate its input', () => {
    const before: Checkpoint[] = []
    setHumanHold(before, true, 'x', uid)
    expect(before).toEqual([])
  })
})

describe('landing defaults (J5.4)', () => {
  it('templates land held by default', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(instantiateTemplate(template).landing).toEqual({ hold: true })
    }
  })

  it('drafted approaches land held by default', () => {
    const result = parseApproachDraft(
      JSON.stringify({ name: 'X', stages: [{ name: 'Review', type: 'review' }] }),
      'brief-1'
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body.landing).toEqual({ hold: true })
  })
})
