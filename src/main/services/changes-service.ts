import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveExecutionMode } from '@shared/domain'
import {
  type FileChange,
  type FlightChanges,
  type RepoChanges,
  parseNumstat,
  totalChanges
} from '@shared/changes'
import { instanceNameForFlight } from './infra'
import type { InfraService } from './infra-service'
import type { FlightStore } from './flight-store'

/** Runs a `git` command in a cwd; injected so the service is unit-testable. */
export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string }>

const defaultGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, out) => {
      const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0
      resolve({ code, stdout: out ?? '' })
    })
  })

/** Reads a file's text; injected for testability. Returns null if unreadable. */
export type FileReader = (path: string) => Promise<string | null>

const defaultReader: FileReader = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Cap per untracked file we'll read to count lines (skip huge/binary blobs). */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

/**
 * Computes the broad changes summary for a flight's workspace (Phase J7.5): the
 * files touched and their +/- across every worktree, by shelling `git diff
 * --numstat` against each worktree's base, plus counting untracked new files.
 * Read-only — it never mutates the worktree or its index. Degrades to
 * `available: false` with a reason when there is no workspace to inspect.
 */
export class ChangesService {
  constructor(
    private readonly infra: InfraService,
    private readonly flights: FlightStore,
    private readonly git: GitRunner = defaultGit,
    private readonly readText: FileReader = defaultReader
  ) {}

  async changes(flightId: string): Promise<FlightChanges> {
    const none = (reason: string): FlightChanges => ({
      flightId,
      available: false,
      reason,
      repos: [],
      totalAdditions: 0,
      totalDeletions: 0
    })

    const run = await this.flights.get(flightId)
    if (!run) return none('Flight not found.')

    const ctx = await this.flights.getContext(flightId)
    if (!ctx) return none('This flight has no recorded context.')

    const mode = resolveExecutionMode({
      executionMode: ctx.executionMode ?? undefined,
      infraTemplate: ctx.infraTemplate
    })
    if (mode !== 'infra') {
      return none('Changes are summarised for flights in an isolated workspace.')
    }
    if (!this.infra.isConfigured()) return none('No infrastructure provider is configured.')

    const instance = await this.infra.info(instanceNameForFlight(flightId)).catch(() => null)
    if (!instance) return none('The workspace has been torn down; there is nothing to show.')

    const repos: RepoChanges[] = []
    for (const worktree of instance.worktrees) {
      const files = await this.worktreeChanges(worktree.path, worktree.base ?? 'HEAD')
      repos.push({ repo: worktree.repo, files })
    }

    const totals = totalChanges(repos)
    return {
      flightId,
      available: true,
      reason: null,
      repos,
      totalAdditions: totals.additions,
      totalDeletions: totals.deletions
    }
  }

  /** Numstat of tracked edits vs `base`, plus untracked new files, in one worktree. */
  private async worktreeChanges(dir: string, base: string): Promise<FileChange[]> {
    const diff = await this.git(['diff', '--numstat', base], dir)
    const files = diff.code === 0 ? parseNumstat(diff.stdout) : []

    const untracked = await this.git(['ls-files', '--others', '--exclude-standard'], dir)
    if (untracked.code === 0) {
      for (const rel of untracked.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        files.push(await this.untrackedChange(dir, rel))
      }
    }
    return files
  }

  /** A new (untracked) file counts as all-additions; binary/huge files show 0. */
  private async untrackedChange(dir: string, rel: string): Promise<FileChange> {
    const text = await this.readText(join(dir, rel))
    if (text === null || text.length > MAX_UNTRACKED_BYTES || text.includes('\0')) {
      return { path: rel, additions: 0, deletions: 0, binary: true }
    }
    const additions = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    return { path: rel, additions, deletions: 0, binary: false }
  }
}
