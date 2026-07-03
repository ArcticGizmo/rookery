import { ref } from 'vue'
import { type RepoProbe, normalizeRepoPath } from '@shared/workspace'
import { rookery } from '@renderer/lib/rookery'

/** An editable repo row with transient probe/autocomplete UI state (not persisted). */
export interface RepoRow {
  name: string
  localPath: string
  remoteUrl: string
  /** Last probe of `localPath` (git-ness + inferred remote). */
  probe: RepoProbe | null
  /** Directory autocomplete candidates for the current `localPath`. */
  suggestions: string[]
}

/**
 * Attaching repos to a brief: add/remove rows, live directory autocomplete, and a
 * git probe that infers the remote URL. Shared by the brief composer and editor so
 * the path-handling logic lives in one place.
 */
export function useRepoRows() {
  const repos = ref<RepoRow[]>([])
  let listRequestId = 0

  function add(): void {
    repos.value.push({ name: '', localPath: '', remoteUrl: '', probe: null, suggestions: [] })
  }

  function remove(index: number): void {
    repos.value.splice(index, 1)
  }

  // Fetch directory candidates as the user types, converting Windows backslashes
  // live. A request id guards against out-of-order responses.
  async function onPathInput(repo: RepoRow): Promise<void> {
    repo.localPath = repo.localPath.replace(/\\/g, '/')
    repo.probe = null // stale until re-probed on blur
    const id = ++listRequestId
    const suggestions = await rookery().workspace.listDirs(repo.localPath)
    if (id === listRequestId) repo.suggestions = suggestions
  }

  // Probe the path for git-ness + remote URL (on blur or after picking a folder).
  async function probe(repo: RepoRow): Promise<void> {
    repo.localPath = normalizeRepoPath(repo.localPath)
    if (repo.localPath === '') {
      repo.probe = null
      return
    }
    const result = await rookery().workspace.probeRepo(repo.localPath)
    repo.probe = result
    if (result.isGitRepo && result.remoteUrl && repo.remoteUrl.trim() === '') {
      repo.remoteUrl = result.remoteUrl
    }
  }

  async function browse(repo: RepoRow): Promise<void> {
    const picked = await rookery().workspace.pickDirectory(repo.localPath || undefined)
    if (picked) {
      repo.localPath = picked
      await probe(repo)
    }
  }

  /** Seed rows from a loaded brief's repos, probing each for git hints. */
  function setFrom(rows: { name: string; localPath: string; remoteUrl?: string | null }[]): void {
    repos.value = rows.map((r) => ({
      name: r.name,
      localPath: r.localPath,
      remoteUrl: r.remoteUrl ?? '',
      probe: null,
      suggestions: []
    }))
    for (const repo of repos.value) void probe(repo)
  }

  /** Trimmed payload for the domain layer; empty remote URL → undefined. */
  function payload(): { name: string; localPath: string; remoteUrl: string | undefined }[] {
    return repos.value.map((r) => ({
      name: r.name.trim(),
      localPath: r.localPath.trim(),
      remoteUrl: r.remoteUrl.trim() === '' ? undefined : r.remoteUrl.trim()
    }))
  }

  return { repos, add, remove, onPathInput, probe, browse, setFrom, payload }
}
