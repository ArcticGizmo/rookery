import { describe, expect, it } from 'vitest'
import {
  checkpointLabel,
  doneCriterionLabel,
  stageRoles,
  stageTypeLabel
} from '../../src/shared/approach-view'
import type { Stage } from '../../src/shared/domain'

describe('approach-view labels', () => {
  it('gives every stage type a human title', () => {
    expect(stageTypeLabel('review')).toBe('Review the brief')
    expect(stageTypeLabel('implementation')).toBe('Build it')
    expect(stageTypeLabel('verification')).toBe('Verify end-to-end')
    expect(stageTypeLabel('custom')).toBe('Custom step')
  })

  it('phrases each done-criterion type as an outcome', () => {
    expect(doneCriterionLabel('manual')).toBe('You approve it')
    expect(doneCriterionLabel('tests_pass')).toBe('The test suite passes')
    expect(doneCriterionLabel('reviewer_approves')).toBe('A reviewer approves the work')
  })

  it('distinguishes held from automated checkpoints', () => {
    expect(checkpointLabel('human')).toBe('Hold for you')
    expect(checkpointLabel('automated')).toBe('Automated')
  })
})

describe('stageRoles', () => {
  const stage = (personas: { name: string; role: string }[]): Stage => ({
    id: 's',
    name: 'S',
    type: 'review',
    personas: personas.map((p, i) => ({ id: `p${i}`, name: p.name, role: p.role, systemPrompt: '' })),
    doneCriteria: [],
    checkpoints: []
  })

  it('lists distinct roles in order', () => {
    expect(stageRoles(stage([{ name: 'A', role: 'Tech Lead' }, { name: 'B', role: 'Product' }]))).toEqual([
      'Tech Lead',
      'Product'
    ])
  })

  it('de-duplicates and falls back to the persona name when role is blank', () => {
    expect(
      stageRoles(stage([{ name: 'A', role: 'Reviewer' }, { name: 'B', role: 'Reviewer' }, { name: 'Solo', role: '' }]))
    ).toEqual(['Reviewer', 'Solo'])
  })
})
