import { describe, expect, it } from 'vitest'
import { WORKFLOW_TEMPLATES, instantiateTemplate } from '../../src/shared/workflow-templates'
import { validateWorkflow } from '../../src/shared/workflow-validation'

/** Deterministic id factory so assertions don't depend on random UUIDs. */
function counterUid(): () => string {
  let n = 0
  return () => `id-${n++}`
}

describe('workflow templates', () => {
  it('ships the Vue and .NET templates', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.id).sort()).toEqual(['dotnet', 'vue'])
  })

  for (const template of WORKFLOW_TEMPLATES) {
    describe(`template "${template.id}"`, () => {
      it('instantiates to a valid, runnable workflow', () => {
        const body = instantiateTemplate(template, counterUid())
        const result = validateWorkflow(body)
        expect(result.issues).toEqual([])
        expect(result.ok).toBe(true)
      })

      it('assigns unique ids across stages, personas, criteria, and gates', () => {
        const body = instantiateTemplate(template, counterUid())
        const ids = body.stages.flatMap((s) => [
          s.id,
          ...s.personas.map((p) => p.id),
          ...s.passCriteria.map((c) => c.id),
          ...s.gates.map((g) => g.id)
        ])
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('gives every agent-driven stage a persona with a system prompt', () => {
        const body = instantiateTemplate(template, counterUid())
        for (const stage of body.stages) {
          if (['review', 'plan', 'implementation', 'verification'].includes(stage.type)) {
            expect(stage.personas.length).toBeGreaterThan(0)
            expect(stage.personas.every((p) => p.systemPrompt.trim().length > 0)).toBe(true)
          }
        }
      })

      it('never judges produced code before an implementation stage exists', () => {
        // `reviewer_approves`/`tests_pass` ask "does this satisfy the spec?" — only
        // answerable once code has been written. A pre-implementation stage using
        // them can only reject and fails the run at stage one (see criteria.ts).
        const body = instantiateTemplate(template, counterUid())
        const firstImpl = body.stages.findIndex((s) => s.type === 'implementation')
        const codeJudging = new Set(['reviewer_approves', 'tests_pass'])
        body.stages.forEach((stage, i) => {
          if (firstImpl !== -1 && i >= firstImpl) return
          for (const c of stage.passCriteria) {
            expect(codeJudging.has(c.type), `${stage.name} uses ${c.type} before any code exists`).toBe(
              false
            )
          }
        })
      })

      it('produces a fresh copy each time (no shared references)', () => {
        const a = instantiateTemplate(template, counterUid())
        const b = instantiateTemplate(template, counterUid())
        a.stages[0]!.name = 'mutated'
        expect(b.stages[0]!.name).not.toBe('mutated')
      })
    })
  }
})
