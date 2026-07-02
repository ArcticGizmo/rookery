import { execFile } from 'node:child_process'
import type { LandingResult } from '@shared/landing'
import {
  type LandingProvider,
  type LandingSpec,
  LandingToolingMissingError
} from './landing-provider'

/** Result of one CLI invocation. */
export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a `git`/`gh` command in a cwd. Injected so the provider is unit-testable. */
export type LandingCli = (cmd: 'git' | 'gh', args: string[], cwd: string) => Promise<CliResult>

const GH_HINT = 'gh CLI not found on PATH. Install and authenticate it: https://cli.github.com'

/** Default runner: spawns the real `git`/`gh` binaries. */
const defaultCli: LandingCli = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, out, err) => {
      const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null
      if (e && e.code === 'ENOENT') {
        reject(
          new LandingToolingMissingError(
            cmd === 'gh' ? GH_HINT : `${cmd} CLI not found on PATH.`
          )
        )
        return
      }
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0
      resolve({ code, stdout: out ?? '', stderr: err ?? '' })
    })
  })

/** First URL found in text (gh prints the PR URL on success). */
function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/)
  return match ? match[0] : null
}

function fail(action: string, res: CliResult): never {
  throw new Error(`${action} failed (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
}

/**
 * `LandingProvider` backed by `git` + the GitHub `gh` CLI (Phase 6.4). PRs push
 * the feature branch and run `gh pr create` from the worktree (gh infers the
 * repo from the worktree's remote). Merges run in the primary checkout so the
 * base branch can be checked out without disturbing the worktree, then push the
 * base. Never runs interactively.
 */
export class GitLandingProvider implements LandingProvider {
  readonly name = 'git'

  constructor(private readonly cli: LandingCli = defaultCli) {}

  async available(): Promise<boolean> {
    try {
      // Any exit code means git resolved; only a spawn failure means "no".
      await this.cli('git', ['--version'], process.cwd())
      return true
    } catch {
      return false
    }
  }

  async openPr(spec: LandingSpec): Promise<LandingResult> {
    const push = await this.cli(
      'git',
      ['push', '--set-upstream', 'origin', spec.branch],
      spec.worktreePath
    )
    if (push.code !== 0) fail('git push', push)

    const pr = await this.cli(
      'gh',
      [
        'pr',
        'create',
        '--head',
        spec.branch,
        '--base',
        spec.base,
        '--title',
        spec.title,
        '--body',
        spec.body
      ],
      spec.worktreePath
    )
    if (pr.code !== 0) fail('gh pr create', pr)

    const out = `${pr.stdout}\n${pr.stderr}`.trim()
    return {
      repo: spec.repo,
      method: 'pr',
      prUrl: firstUrl(out),
      mergedInto: null,
      detail: out || `Opened a PR for ${spec.branch} → ${spec.base}`
    }
  }

  async merge(spec: LandingSpec): Promise<LandingResult> {
    // Operate in the primary checkout: the worktree already holds the feature
    // branch, so the base branch can only be checked out elsewhere.
    const checkout = await this.cli('git', ['checkout', spec.base], spec.localPath)
    if (checkout.code !== 0) fail(`git checkout ${spec.base}`, checkout)

    const merge = await this.cli(
      'git',
      ['merge', '--no-ff', spec.branch, '-m', `Land ${spec.branch} into ${spec.base}`],
      spec.localPath
    )
    if (merge.code !== 0) fail(`git merge ${spec.branch}`, merge)

    const push = await this.cli('git', ['push', 'origin', spec.base], spec.localPath)
    if (push.code !== 0) fail('git push', push)

    const out = `${merge.stdout}\n${push.stdout}`.trim()
    return {
      repo: spec.repo,
      method: 'merge',
      prUrl: null,
      mergedInto: spec.base,
      detail: out || `Merged ${spec.branch} into ${spec.base} and pushed`
    }
  }
}
