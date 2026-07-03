import type { LandingResult } from '@shared/landing'
import type { LandingProvider, LandingSpec } from './landing-provider'

/**
 * An in-memory `LandingProvider` (Phase 6.4) that records the intended landing
 * without touching git or a remote. Backs unit tests and git-free local dev
 * (`ROOKERY_LANDING_PROVIDER=stub`), so the landing service, IPC, and run view
 * can be exercised end-to-end without a real repo or `gh` auth.
 */
export class StubLandingProvider implements LandingProvider {
  readonly name = 'stub'

  /** Every landing this provider was asked to perform, for test assertions. */
  readonly calls: LandingSpec[] = []

  available(): Promise<boolean> {
    return Promise.resolve(true)
  }

  openPr(spec: LandingSpec): Promise<LandingResult> {
    this.calls.push(spec)
    return Promise.resolve({
      repo: spec.repo,
      method: 'pr',
      prUrl: `https://example.test/${spec.repo}/pull/1`,
      mergedInto: null,
      detail: `(stub) opened PR for ${spec.branch} → ${spec.base}`
    })
  }

  merge(spec: LandingSpec): Promise<LandingResult> {
    this.calls.push(spec)
    return Promise.resolve({
      repo: spec.repo,
      method: 'merge',
      prUrl: null,
      mergedInto: spec.base,
      detail: `(stub) merged ${spec.branch} into ${spec.base}`
    })
  }
}
