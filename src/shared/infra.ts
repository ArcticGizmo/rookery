/**
 * Infrastructure data shapes (Phase 5). Provisioning isolated worktrees + docker
 * infra per run is done behind the `InfraProvider` port (main process); these are
 * the pure, serializable shapes that cross the IPC boundary to the UI. No
 * Electron/Node/DOM deps here.
 */

/** Whether an instance's docker infra is up, as reported by the provider. */
export type InfraInstanceState = 'absent' | 'up' | 'down' | 'unknown'

/** One repo's worktree within a provisioned instance. */
export interface InfraWorktree {
  /** Repo alias (the worktree folder name). */
  repo: string
  /** Absolute path to the created worktree. */
  path: string
  /** Branch checked out in the worktree, if known. */
  branch: string | null
  /** Base ref the worktree branch was created from, if known. */
  base: string | null
  /** Health flags surfaced by the provider (sprig: source/worktree presence). */
  sourceMissing?: boolean
  worktreeMissing?: boolean
}

/** A provisioned isolated instance: a set of worktrees plus its docker infra. */
export interface InfraInstance {
  name: string
  template: string | null
  /** Slot backing port isolation (0,1,2…); null when the provider has no slots. */
  slot: number | null
  state: InfraInstanceState
  worktrees: InfraWorktree[]
  /** Number of running containers the provider reports for this instance. */
  containerCount: number
  /** Concrete host ports this instance claimed, when the provider reports them. */
  ports: number[]
}

/** What the setup stage asks the provider to create. */
export interface InfraInstanceSpec {
  /** Instance id/name (derived deterministically from the run). */
  name: string
  /** Provider template/stack to base the instance on (sprig template). */
  template: string
  /** Optional base ref for the worktrees (default: provider's current HEAD). */
  base?: string
  /** Optional branch name for the worktrees (default: the instance name). */
  branch?: string
  /**
   * Impacted repo aliases, as a hint for providers that build worktrees from an
   * explicit repo list. Sprig derives repos from its template and ignores this.
   */
  repos?: string[]
}

/** Lifecycle status of a run's infrastructure, surfaced to the run view. */
export type RunInfraStatus = 'none' | 'provisioning' | 'up' | 'down' | 'failed'

/**
 * Per-run infrastructure summary for the UI (Phase 5.5). Combines who the
 * provider is, whether its tooling is installed, and the live instance state.
 */
export interface RunInfra {
  runId: string
  /** Configured provider name (e.g. 'sprig', 'stub', or 'none'). */
  provider: string
  /** Whether the provider's backing tooling resolves (e.g. sprig on PATH). */
  providerAvailable: boolean
  /** The instance name this run uses, or null when no provider is configured. */
  instanceName: string | null
  status: RunInfraStatus
  /** Live instance detail, or null when absent/unavailable. */
  instance: InfraInstance | null
}
