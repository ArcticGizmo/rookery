import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { type BrowserWindow, type OpenDialogOptions, dialog } from 'electron'
import { type RepoProbe, normalizeRepoPath } from '@shared/workspace'

/** Max autocomplete suggestions returned for a partial path. */
const MAX_DIR_SUGGESTIONS = 20

/**
 * Filesystem + git helpers for the brief editor: pick a folder, probe a
 * candidate repo path (git detection + remote/branch inference), and autocomplete
 * directory paths as the user types. Git facts are read straight from `.git`
 * (config/HEAD) so nothing here depends on `git` being installed.
 */
export class WorkspaceService {
  /** Open the OS folder picker; returns the chosen directory or null if cancelled. */
  async pickDirectory(win: BrowserWindow | null, defaultPath?: string): Promise<string | null> {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      ...(defaultPath ? { defaultPath } : {})
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizeRepoPath(result.filePaths[0]!)
  }

  /** Inspect a candidate repo path: existence, git-ness, remote URL, default branch. */
  async probeRepo(localPath: string): Promise<RepoProbe> {
    const path = normalizeRepoPath(localPath)
    const probe: RepoProbe = {
      path,
      exists: false,
      isGitRepo: false,
      remoteUrl: null,
      defaultBranch: null
    }
    if (path === '') return probe

    try {
      probe.exists = (await stat(path)).isDirectory()
    } catch {
      return probe // path does not exist
    }
    if (!probe.exists) return probe

    const gitDir = await this.resolveGitDir(path)
    if (!gitDir) return probe
    probe.isGitRepo = true

    try {
      probe.remoteUrl = parseGitConfigOriginUrl(await readFile(join(gitDir, 'config'), 'utf8'))
    } catch {
      /* no readable config — leave remoteUrl null */
    }
    try {
      probe.defaultBranch = parseGitHeadBranch(await readFile(join(gitDir, 'HEAD'), 'utf8'))
    } catch {
      /* no readable HEAD — leave defaultBranch null */
    }
    return probe
  }

  /**
   * Directory-path autocomplete. Lists child directories of the typed path (when
   * it ends in a separator) or sibling directories whose name matches the trailing
   * segment. Returns normalized absolute paths; empty on a blank or unreadable dir.
   */
  async listDirs(input: string): Promise<string[]> {
    const norm = input.replace(/\\/g, '/')
    if (norm.trim() === '') return []

    const endsWithSep = norm.endsWith('/')
    const dir = endsWithSep ? norm : dirname(norm)
    const prefix = endsWithSep ? '' : basename(norm).toLowerCase()

    try {
      const entries = await readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix))
        .slice(0, MAX_DIR_SUGGESTIONS)
        .map((e) => normalizeRepoPath(join(dir, e.name)))
    } catch {
      return []
    }
  }

  /**
   * Resolve the actual git dir for a checkout: a normal `.git` directory, or the
   * target of a `.git` *file* (`gitdir: …`) used by worktrees/submodules. Returns
   * null when there's no `.git` at all.
   */
  private async resolveGitDir(path: string): Promise<string | null> {
    const dotGit = join(path, '.git')
    try {
      const st = await stat(dotGit)
      if (st.isDirectory()) return dotGit
      if (st.isFile()) {
        const match = (await readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+)$/m)
        return match ? resolve(path, match[1]!.trim()) : null
      }
    } catch {
      /* no .git entry */
    }
    return null
  }
}

/** Extract `remote.origin.url` from a git config file's text. */
export function parseGitConfigOriginUrl(config: string): string | null {
  let inOrigin = false
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    const section = line.match(/^\[(.+)\]$/)
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1]!.trim())
      continue
    }
    if (inOrigin) {
      const url = line.match(/^url\s*=\s*(.+)$/)
      if (url) return url[1]!.trim()
    }
  }
  return null
}

/** Extract the branch name from `.git/HEAD` (`ref: refs/heads/<branch>`). */
export function parseGitHeadBranch(head: string): string | null {
  const match = head.match(/ref:\s*refs\/heads\/(.+)$/m)
  return match ? match[1]!.trim() : null
}
