import { describe, expect, it } from 'vitest'
import type { ApproachDefBody } from '../../src/shared/domain'
import { validateApproach } from '../../src/shared/approach-validation'

function persona(id: string, prompt = 'Do the thing'): ApproachDefBody['stages'][number]['personas'][number] {
  return { id, name: `Persona ${id}`, role: 'Reviewer', systemPrompt: prompt, model: undefined }
}

function validApproach(): ApproachDefBody {
  return {
    name: 'Basic feature',
    description: '',
    stages: [
      {
        id: 's1',
        name: 'Review spec',
        type: 'review',
        personas: [persona('p1')],
        passCriteria: [{ id: 'c1', type: 'personas_agree', description: '' }],
        checkpoints: [{ id: 'g1', kind: 'human', description: 'Approve' }]
      },
      {
        id: 's2',
        name: 'Setup',
        type: 'setup',
        personas: [],
        passCriteria: [],
        checkpoints: []
      }
    ]
  }
}

describe('validateApproach', () => {
  it('accepts a well-formed approach', () => {
    const result = validateApproach(validApproach())
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects a approach with no stages', () => {
    const result = validateApproach({ name: 'Empty', description: '', stages: [] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path === 'stages')).toBe(true)
  })

  it('reports zod shape errors (missing name)', () => {
    const result = validateApproach({ description: '', stages: [] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path.includes('name'))).toBe(true)
  })

  it('flags duplicate stage ids', () => {
    const wf = validApproach()
    wf.stages[1]!.id = 's1'
    const result = validateApproach(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('Duplicate stage id'))).toBe(true)
  })

  it('requires personas on agent-driven stages', () => {
    const wf = validApproach()
    wf.stages[0]!.personas = []
    const result = validateApproach(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path.endsWith('personas'))).toBe(true)
  })

  it('flags a persona with no system prompt', () => {
    const wf = validApproach()
    wf.stages[0]!.personas = [persona('p1', '   ')]
    const result = validateApproach(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('no system prompt'))).toBe(true)
  })

  it('requires pass criteria when a stage has an automated checkpoint', () => {
    const wf = validApproach()
    wf.stages[0]!.checkpoints = [{ id: 'g1', kind: 'automated', description: '' }]
    wf.stages[0]!.passCriteria = []
    const result = validateApproach(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('automated checkpoint'))).toBe(true)
  })

  it('flags persona-dependent criteria with no personas', () => {
    const wf = validApproach()
    // A setup-type stage exempt from the persona requirement but carrying a
    // reviewer_approves criterion should still be flagged.
    wf.stages[1]!.passCriteria = [{ id: 'c9', type: 'reviewer_approves', description: '' }]
    const result = validateApproach(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('requires at least one persona'))).toBe(true)
  })
})
