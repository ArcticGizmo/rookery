import type { LandingMethod } from '@shared/domain'
import type { LandingResult } from '@shared/landing'

/**
 * Everything a provider needs to land one repo. Both the worktree (where the
 * feature branch is checked out) and the primary local checkout (which hosts the
 * base branch) are supplied so the provider can push from one and merge in the
 * other without a working-tree conflict.
 */
export interface LandingSpec {
  flightId: string
  repo: string
  method: LandingMethod
  /** The run's isolated worktree for this repo (feature branch checked out). */
  worktreePath: string
  /** The repo's primary local checkout (base branch host, for merges). */
  localPath: string
  /** Feature branch to land. */
  branch: string
  /** Base branch to land into (e.g. `main`). */
  base: string
  remoteUrl: string | null
  /** PR title (method `pr`). */
  title: string
  /** PR body (method `pr`). */
  body: string
}

/**
 * The landing port (Phase 6.4). Turns a human's "get this change to main"
 * decision into real git/gh actions. `GitLandingProvider` (shells out to `git`
 * and `gh`) is the v1 implementation; `StubLandingProvider` backs tests and
 * git-free dev. The `LandingService` only ever talks to this interface, so an
 * alternate backend (e.g. a hosted API) can be slotted in without touching the
 * service or UI.
 *
 * Implementations should throw with the underlying tooling error on failure; the
 * service audits it as `run.landing_failed`.
 */
export interface LandingProvider {
  /** Stable provider id, surfaced in audit events and the UI. */
  readonly name: string

  /** Whether the backing tooling is installed and usable (e.g. git on PATH). */
  available(): Promise<boolean>

  /** Push the feature branch and open a pull request against the base. */
  openPr(spec: LandingSpec): Promise<LandingResult>

  /** Merge the feature branch into the base branch and push the base. */
  merge(spec: LandingSpec): Promise<LandingResult>
}

/** Thrown when a provider's backing tooling is not installed / not on PATH. */
export class LandingToolingMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LandingToolingMissingError'
  }
}
