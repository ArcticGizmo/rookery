/**
 * Structural validation for approach definitions (Phase 2.5). Runs before a run
 * can start. Pure and dependency-light so it can be used in the renderer (inline
 * builder errors) and the main process (guard before persisting / running).
 *
 * Two layers: zod shape validation, then semantic rules zod can't express
 * (uniqueness, cross-references, stage/persona/gate coherence).
 */

import { z } from 'zod'
import {
  type ApproachDefBody,
  passCriterionTypeSchema,
  stageTypeSchema,
  approachDefBodySchema
} from './domain'

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `stages[0].personas`. */
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/** Stage types that must have at least one agent persona assigned. */
const PERSONA_REQUIRED_STAGE_TYPES = new Set<z.infer<typeof stageTypeSchema>>([
  'review',
  'plan',
  'implementation',
  'verification'
])

/** Pass-criterion types whose evaluation depends on agent output. */
const PERSONA_DEPENDENT_CRITERIA = new Set<z.infer<typeof passCriterionTypeSchema>>([
  'reviewer_approves',
  'personas_agree'
])

function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

/**
 * Validate a approach definition body. Returns all issues found (not just the
 * first) so the builder can surface them together.
 */
export function validateApproach(input: unknown): ValidationResult {
  const parsed = approachDefBodySchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message
      }))
    }
  }

  const def: ApproachDefBody = parsed.data
  const issues: ValidationIssue[] = []

  if (def.stages.length === 0) {
    issues.push({ path: 'stages', message: 'A approach needs at least one stage' })
  }

  const dupStageId = firstDuplicate(def.stages.map((s) => s.id))
  if (dupStageId) {
    issues.push({ path: 'stages', message: `Duplicate stage id "${dupStageId}"` })
  }

  const dupStageName = firstDuplicate(
    def.stages.map((s) => s.name.trim().toLowerCase()).filter((n) => n.length > 0)
  )
  if (dupStageName) {
    issues.push({ path: 'stages', message: `Duplicate stage name "${dupStageName}"` })
  }

  def.stages.forEach((stage, index) => {
    const base = `stages[${index}]`

    // Persona completeness: required for agent-driven stage types, and every
    // persona needs instructions to be usable by the engine.
    if (PERSONA_REQUIRED_STAGE_TYPES.has(stage.type) && stage.personas.length === 0) {
      issues.push({
        path: `${base}.personas`,
        message: `Stage "${stage.name}" (${stage.type}) needs at least one persona`
      })
    }
    stage.personas.forEach((persona, pIndex) => {
      if (persona.systemPrompt.trim().length === 0) {
        issues.push({
          path: `${base}.personas[${pIndex}].systemPrompt`,
          message: `Persona "${persona.name}" has no system prompt`
        })
      }
    })
    const dupPersona = firstDuplicate(stage.personas.map((p) => p.id))
    if (dupPersona) {
      issues.push({ path: `${base}.personas`, message: `Duplicate persona id "${dupPersona}"` })
    }

    // Gates.
    const dupGate = firstDuplicate(stage.gates.map((g) => g.id))
    if (dupGate) {
      issues.push({ path: `${base}.gates`, message: `Duplicate gate id "${dupGate}"` })
    }
    const hasAutomatedGate = stage.gates.some((g) => g.kind === 'automated')
    if (hasAutomatedGate && stage.passCriteria.length === 0) {
      issues.push({
        path: `${base}.passCriteria`,
        message: `Stage "${stage.name}" has an automated gate but no pass criteria to evaluate`
      })
    }

    // Pass criteria.
    const dupCriterion = firstDuplicate(stage.passCriteria.map((c) => c.id))
    if (dupCriterion) {
      issues.push({
        path: `${base}.passCriteria`,
        message: `Duplicate pass-criterion id "${dupCriterion}"`
      })
    }
    stage.passCriteria.forEach((criterion, cIndex) => {
      if (PERSONA_DEPENDENT_CRITERIA.has(criterion.type) && stage.personas.length === 0) {
        issues.push({
          path: `${base}.passCriteria[${cIndex}]`,
          message: `Criterion "${criterion.type}" requires at least one persona in the stage`
        })
      }
    })
  })

  return { ok: issues.length === 0, issues }
}
