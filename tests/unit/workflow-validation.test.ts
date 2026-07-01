import { describe, expect, it } from 'vitest'
import type { WorkflowDefBody } from '../../src/shared/domain'
import { validateWorkflow } from '../../src/shared/workflow-validation'

function persona(id: string, prompt = 'Do the thing'): WorkflowDefBody['stages'][number]['personas'][number] {
  return { id, name: `Persona ${id}`, role: 'Reviewer', systemPrompt: prompt, model: undefined }
}

function validWorkflow(): WorkflowDefBody {
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
        gates: [{ id: 'g1', kind: 'human', description: 'Approve' }]
      },
      {
        id: 's2',
        name: 'Setup',
        type: 'setup',
        personas: [],
        passCriteria: [],
        gates: []
      }
    ]
  }
}

describe('validateWorkflow', () => {
  it('accepts a well-formed workflow', () => {
    const result = validateWorkflow(validWorkflow())
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects a workflow with no stages', () => {
    const result = validateWorkflow({ name: 'Empty', description: '', stages: [] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path === 'stages')).toBe(true)
  })

  it('reports zod shape errors (missing name)', () => {
    const result = validateWorkflow({ description: '', stages: [] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path.includes('name'))).toBe(true)
  })

  it('flags duplicate stage ids', () => {
    const wf = validWorkflow()
    wf.stages[1]!.id = 's1'
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('Duplicate stage id'))).toBe(true)
  })

  it('requires personas on agent-driven stages', () => {
    const wf = validWorkflow()
    wf.stages[0]!.personas = []
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path.endsWith('personas'))).toBe(true)
  })

  it('flags a persona with no system prompt', () => {
    const wf = validWorkflow()
    wf.stages[0]!.personas = [persona('p1', '   ')]
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('no system prompt'))).toBe(true)
  })

  it('requires pass criteria when a stage has an automated gate', () => {
    const wf = validWorkflow()
    wf.stages[0]!.gates = [{ id: 'g1', kind: 'automated', description: '' }]
    wf.stages[0]!.passCriteria = []
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('automated gate'))).toBe(true)
  })

  it('flags persona-dependent criteria with no personas', () => {
    const wf = validWorkflow()
    // A setup-type stage exempt from the persona requirement but carrying a
    // reviewer_approves criterion should still be flagged.
    wf.stages[1]!.passCriteria = [{ id: 'c9', type: 'reviewer_approves', description: '' }]
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('requires at least one persona'))).toBe(true)
  })
})
