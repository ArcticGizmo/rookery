import type { LandingProvider } from './landing-provider'
import { GitLandingProvider } from './git-landing-provider'
import { StubLandingProvider } from './stub-landing-provider'

export type { LandingProvider, LandingSpec } from './landing-provider'
export { LandingToolingMissingError } from './landing-provider'
export { GitLandingProvider } from './git-landing-provider'
export { StubLandingProvider } from './stub-landing-provider'

/**
 * Select the landing provider from config (Phase 6.4). `ROOKERY_LANDING_PROVIDER`:
 * - `git` (default) — shell out to `git` + the GitHub `gh` CLI.
 * - `stub` — in-memory fake (no git/remote); for dev/tests without gh auth.
 * - `none` — landing disabled; the run view reports it as unavailable.
 */
export function createLandingProvider(
  kind = process.env['ROOKERY_LANDING_PROVIDER'] ?? 'git'
): LandingProvider | null {
  switch (kind) {
    case 'none':
      return null
    case 'stub':
      return new StubLandingProvider()
    case 'git':
    default:
      return new GitLandingProvider()
  }
}
