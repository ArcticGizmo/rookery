/**
 * Landing data shapes (Phase 6.4). On a successful run a human directs how each
 * impacted repo's change reaches main — open a PR or merge directly. The real
 * git/gh work happens behind a `LandingProvider` port in the main process; these
 * are the pure, serializable shapes that cross the IPC boundary to the UI. No
 * Electron/Node/DOM deps here.
 */

import type { LandingMethod } from './domain'

/** One repo eligible to land: its worktree branch and where it would land. */
export interface LandingTarget {
  /** Repo alias (the worktree folder name). */
  repo: string
  /** Absolute path to the run's isolated worktree for this repo. */
  worktreePath: string
  /** Absolute path to the repo's primary local checkout (merge target host). */
  localPath: string
  /** Feature branch the run's work lives on. */
  branch: string
  /** Base branch the change lands into (e.g. `main`). */
  base: string
  /** Remote URL, when the work item recorded one. */
  remoteUrl: string | null
  /** Whether this repo has already been landed in this run (from the log). */
  landed: boolean
}

/** Whether a run can be landed, and the per-repo targets if so. */
export interface LandingTargets {
  runId: string
  /** Configured landing provider name (e.g. 'git', 'stub', or 'none'). */
  provider: string
  /** Whether the provider's backing tooling resolves (e.g. git/gh on PATH). */
  providerAvailable: boolean
  /** False when the run isn't landable yet (not passed, no live infra, …). */
  canLand: boolean
  /** Why landing is unavailable, when `canLand` is false. */
  reason: string | null
  targets: LandingTarget[]
}

/** The outcome of landing one repo. */
export interface LandingResult {
  repo: string
  method: LandingMethod
  /** PR URL (method `pr`), when the provider reports one. */
  prUrl: string | null
  /** Base branch the change was merged into (method `merge`), when known. */
  mergedInto: string | null
  /** Human-readable detail (CLI summary). */
  detail: string
}
