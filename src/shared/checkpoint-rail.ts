/**
 * The checkpoint rail (Phase J5): placing human checkpoints on an approach's
 * seams. "Hold" drops a human checkpoint at a stage — the flight pauses there
 * until you decide; "Auto" removes it — the work runs unattended past that
 * seam. Pure and framework-free so the rail UI and any guard share one notion
 * of what a hold is, and it can be unit-tested without a component.
 *
 * A checkpoint's `kind` is the source of truth: a stage "holds" iff it carries
 * a `human` checkpoint. Automated checkpoints (satisfied by pass criteria) are
 * left untouched by the toggle.
 */

import type { Checkpoint, Stage, StageType } from './domain'

/** Does this stage hold for a human — i.e. carry a human checkpoint? */
export function stageHolds(stage: Stage): boolean {
  return stage.checkpoints.some((c) => c.kind === 'human')
}

/** A sensible human-readable reason for holding after a stage of this type. */
export function defaultCheckpointDescription(type: StageType): string {
  switch (type) {
    case 'review':
      return 'Approve the review before planning'
    case 'plan':
      return 'Approve the plan before building'
    case 'setup':
      return 'Approve the workspace before building'
    case 'implementation':
      return 'Approve the implementation'
    case 'verification':
      return 'Confirm the feature is done'
    case 'custom':
      return 'Approve before continuing'
  }
}

/**
 * Return a stage's checkpoints with the human hold set on or off — pure, never
 * mutating the input. Turning a hold on adds one human checkpoint (with
 * `description`) unless one already exists; turning it off drops every human
 * checkpoint. Automated checkpoints are always preserved, and an already-held
 * stage is returned unchanged so ids/descriptions survive a round-trip.
 */
export function setHumanHold(
  checkpoints: Checkpoint[],
  hold: boolean,
  description: string,
  uid: () => string = () => crypto.randomUUID()
): Checkpoint[] {
  if (hold) {
    if (checkpoints.some((c) => c.kind === 'human')) return checkpoints
    return [...checkpoints, { id: uid(), kind: 'human', description }]
  }
  return checkpoints.filter((c) => c.kind !== 'human')
}
