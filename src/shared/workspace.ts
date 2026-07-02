/**
 * Shared workspace/filesystem types + helpers for attaching repos to a work item.
 * Pure (no Node/Electron/DOM) so main, preload, and renderer all agree on shapes.
 */

/** What a probe of a candidate repo path found. All fields degrade gracefully. */
export interface RepoProbe {
  /** The normalized path that was probed. */
  path: string
  /** Whether the path exists and is a directory. */
  exists: boolean
  /** Whether it looks like a git repo (a `.git` dir or worktree/submodule file). */
  isGitRepo: boolean
  /** `remote.origin.url` from `.git/config`, when present. */
  remoteUrl: string | null
  /** Branch `.git/HEAD` points at (e.g. `main`), when resolvable. */
  defaultBranch: string | null
}

/**
 * Canonicalize a repo path for storage: trim, convert Windows backslashes to
 * forward slashes (accepted by Node and git on Windows), collapse duplicate
 * separators, and drop a trailing slash. A leading UNC `\\` is preserved as `//`.
 * Returns '' for blank input.
 */
export function normalizeRepoPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  const isUnc = /^[\\/]{2}/.test(trimmed)
  let p = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (isUnc) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}
