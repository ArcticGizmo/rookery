import { execFile } from 'node:child_process'
import type { AuditLog } from './audit-log'

/** Result of one `git` invocation. */
export interface GitCliResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a `git` command in a cwd. Injected so the service is unit-testable. */
export type GitCli = (args: string[], cwd: string) => Promise<GitCliResult>

/** Thrown when `git` is not installed / not on PATH. */
export class GitMissingError extends Error {
  constructor(message = 'git CLI not found on PATH.') {
    super(message)
    this.name = 'GitMissingError'
  }
}

/** Default runner: spawns the real `git` binary. */
const defaultGit: GitCli = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, out, err) => {
        const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (e && e.code === 'ENOENT') {
          reject(new GitMissingError())
          return
        }
        const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0
        resolve({ code, stdout: out ?? '', stderr: err ?? '' })
      }
    )
  })

/**
 * Prepares a plain git branch on a work item's own repo checkout for the
 * `local_branch` execution mode — the sprig/Docker-free write path. Lets a run's
 * implementer agents edit real files on a named branch so a user can evaluate the
 * quality of the changes before wiring up isolated infra. Changes are left in the
 * working tree for the user to review and land manually; the security backstop in
 * `persona-mapping` still blocks `git push`, Docker, and network egress.
 *
 * `git` is injected so this is unit-testable without a real repo.
 */
export class LocalBranchService {
  constructor(
    private readonly audit: AuditLog,
    private readonly git: GitCli = defaultGit
  ) {}

  /** Whether `git` resolves on this machine. */
  async available(): Promise<boolean> {
    try {
      await this.git(['--version'], process.cwd())
      return true
    } catch {
      return false
    }
  }

  /** The repo's current branch name, or null when it isn't a git work tree. */
  async currentBranch(repoPath: string): Promise<string | null> {
    try {
      const res = await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
      if (res.code !== 0) return null
      return res.stdout.trim() || null
    } catch {
      return null
    }
  }

  /**
   * Ensure `branch` is checked out on `repoPath`, ready for edits. Idempotent: if
   * the repo is already on `branch` it's a no-op, so a setup stage re-entered
   * during a fix loop doesn't trip the clean-tree check on the edits it just made.
   * Switching *from another branch* requires a clean working tree, so a user's
   * uncommitted work is never carried onto — or clobbered by — the run's branch.
   * Emits `run.branch_ready` on success and `run.branch_failed` on any problem;
   * returns false on failure (the caller fails the setup stage).
   */
  async prepare(runId: string, repo: string, repoPath: string, branch: string): Promise<boolean> {
    try {
      const inside = await this.git(['rev-parse', '--is-inside-work-tree'], repoPath)
      if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
        return this.fail(runId, repo, branch, `${repoPath} is not a git repository`)
      }

      // Already on the branch (e.g. a re-entered setup stage): accept as-is.
      if ((await this.currentBranch(repoPath)) === branch) {
        return this.ready(runId, repo, branch, repoPath)
      }

      const status = await this.git(['status', '--porcelain'], repoPath)
      if (status.code === 0 && status.stdout.trim() !== '') {
        return this.fail(
          runId,
          repo,
          branch,
          `Working tree at ${repoPath} has uncommitted changes; commit, stash, or discard ` +
            `them before running in local-branch mode.`
        )
      }

      const exists = await this.git(
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
        repoPath
      )
      const checkout =
        exists.code === 0
          ? await this.git(['checkout', branch], repoPath)
          : await this.git(['checkout', '-b', branch], repoPath)
      if (checkout.code !== 0) {
        return this.fail(
          runId,
          repo,
          branch,
          checkout.stderr.trim() || checkout.stdout.trim() || 'git checkout failed'
        )
      }

      return this.ready(runId, repo, branch, repoPath)
    } catch (error) {
      return this.fail(runId, repo, branch, error instanceof Error ? error.message : String(error))
    }
  }

  private async ready(runId: string, repo: string, branch: string, path: string): Promise<true> {
    await this.emit(runId, {
      type: 'run.branch_ready',
      actor: 'system',
      payload: { runId, repo, branch, path }
    })
    return true
  }

  private async fail(runId: string, repo: string, branch: string, message: string): Promise<false> {
    await this.emit(runId, {
      type: 'run.branch_failed',
      actor: 'system',
      payload: { runId, repo, branch, message }
    })
    return false
  }

  private async emit(runId: string, event: Parameters<AuditLog['append']>[0]): Promise<void> {
    try {
      await this.audit.append({ ...event, runId })
    } catch (error) {
      console.error('Failed to append local-branch event:', error)
    }
  }
}
