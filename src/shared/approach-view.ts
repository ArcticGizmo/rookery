/**
 * Presentation helpers that turn an approach's machine vocabulary (stage types,
 * done-criterion types, checkpoint kinds) into the plain language the journey
 * shows (Phase J4.1). Pure and framework-free so the approach step and any other
 * surface render stages the same way.
 */

import type { DoneCriterionType, StageType, CheckpointKind, Stage } from './domain'

/** Human title for a stage type — what the step is, in the user's words. */
export function stageTypeLabel(type: StageType): string {
  switch (type) {
    case 'review':
      return 'Review the brief'
    case 'plan':
      return 'Plan the work'
    case 'setup':
      return 'Prepare the workspace'
    case 'implementation':
      return 'Build it'
    case 'verification':
      return 'Verify end-to-end'
    case 'custom':
      return 'Custom step'
  }
}

/** A one-line "done means…" phrasing for a criterion type. */
export function doneCriterionLabel(type: DoneCriterionType): string {
  switch (type) {
    case 'manual':
      return 'You approve it'
    case 'reviewer_approves':
      return 'A reviewer approves the work'
    case 'personas_agree':
      return 'The reviewers agree no changes are needed'
    case 'tests_pass':
      return 'The test suite passes'
  }
}

/** Whether a checkpoint holds for a human (vs. an automated gate). */
export function checkpointLabel(kind: CheckpointKind): string {
  return kind === 'human' ? 'Hold for you' : 'Automated'
}

/** Distinct role names present on a stage's personas, in order, de-duplicated. */
export function stageRoles(stage: Stage): string[] {
  const seen = new Set<string>()
  const roles: string[] = []
  for (const p of stage.personas) {
    const role = p.role.trim() || p.name.trim()
    if (role && !seen.has(role)) {
      seen.add(role)
      roles.push(role)
    }
  }
  return roles
}
