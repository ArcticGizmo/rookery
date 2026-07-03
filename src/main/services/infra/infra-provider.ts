import type { InfraInstance, InfraInstanceSpec, InfraInstanceState } from '@shared/infra'

/**
 * The infrastructure port (Phase 5.1). Provisions isolated worktrees + docker
 * infra so concurrent flights don't collide. `SprigProvider` (shells out to the
 * `sprig` CLI) is the v1 implementation; `StubProvider` backs tests and infra-
 * free dev. The orchestration engine only ever talks to this interface, so a
 * native backend can be slotted in later without touching the engine.
 *
 * Contract:
 * - `available()` reports whether the backing tooling resolves (e.g. sprig on
 *   PATH). Callers should check it before provisioning and surface a clear error.
 * - `create()` provisions worktrees and brings infra up, returning the live
 *   instance. Names are expected to be unique per run.
 * - `up()` / `down()` start/stop infra for an existing instance.
 * - `info()` returns the live instance or `null` when it does not exist.
 * - `status()` is a cheap `info()` that returns only the infra state.
 * - `remove()` tears the instance down permanently (worktrees + branches).
 *
 * Implementations must not throw for a merely-absent instance in `info`/`status`
 * (return `null` / `'absent'`); they may throw for tooling/environment failures.
 */
export interface InfraProvider {
  /** Stable provider id, surfaced in audit events and the UI. */
  readonly name: string

  /** Whether the backing tooling is installed and usable. */
  available(): Promise<boolean>

  /** Provision worktrees + bring infra up; returns the live instance. */
  create(spec: InfraInstanceSpec): Promise<InfraInstance>

  /** Bring an existing instance's infra up; returns the live instance. */
  up(name: string): Promise<InfraInstance>

  /** Stop an existing instance's infra. No-op if already down. */
  down(name: string): Promise<void>

  /** Live detail for an instance, or null when it does not exist. */
  info(name: string): Promise<InfraInstance | null>

  /** Cheap state probe; `'absent'` when the instance does not exist. */
  status(name: string): Promise<InfraInstanceState>

  /** Permanently tear an instance down (worktrees + local branches). */
  remove(name: string): Promise<void>
}

/** Thrown when a provider's backing tooling is not installed / not on PATH. */
export class InfraToolingMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InfraToolingMissingError'
  }
}
