/**
 * The broad changes summary for a flight's workspace (Phase J7.5): which files
 * the work touched, and by how much (+/-). Populated by running `git diff
 * --numstat` in each worktree in the main process; the parsing is pure and
 * lives here so it can be unit-tested without git.
 */

/** One file's change, as a numstat row. Binary files report no line counts. */
export interface FileChange {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

/** The changes within one repo's worktree. */
export interface RepoChanges {
  repo: string
  files: FileChange[]
}

/** The workspace-wide change summary for a flight. */
export interface FlightChanges {
  flightId: string
  /** False when there is no workspace to diff (read-only, torn down, no infra). */
  available: boolean
  /** Why nothing is shown, when `available` is false. */
  reason: string | null
  repos: RepoChanges[]
  totalAdditions: number
  totalDeletions: number
}

/**
 * Parse `git diff --numstat` output into file changes. Each row is
 * `<additions>\t<deletions>\t<path>`; binary files render as `-\t-\t<path>`.
 * Malformed or empty lines are skipped.
 */
export function parseNumstat(stdout: string): FileChange[] {
  const files: FileChange[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [add, del, ...rest] = parts
    const path = rest.join('\t').trim()
    if (!path) continue
    const binary = add === '-' || del === '-'
    files.push({
      path,
      additions: binary ? 0 : Number(add) || 0,
      deletions: binary ? 0 : Number(del) || 0,
      binary
    })
  }
  return files
}

/** Sum a set of repo changes into workspace totals. */
export function totalChanges(repos: RepoChanges[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const repo of repos) {
    for (const file of repo.files) {
      additions += file.additions
      deletions += file.deletions
    }
  }
  return { additions, deletions }
}
