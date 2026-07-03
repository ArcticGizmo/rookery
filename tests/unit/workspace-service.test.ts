import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeRepoPath } from '../../src/shared/workspace'
import {
  WorkspaceService,
  parseGitConfigOriginUrl,
  parseGitHeadBranch
} from '../../src/main/services/workspace-service'

describe('normalizeRepoPath', () => {
  it('converts backslashes, collapses separators, and trims trailing slashes', () => {
    expect(normalizeRepoPath('  C:\\git\\api\\  ')).toBe('C:/git/api')
    expect(normalizeRepoPath('C:/git//api/')).toBe('C:/git/api')
    expect(normalizeRepoPath('/usr/local/')).toBe('/usr/local')
    expect(normalizeRepoPath('')).toBe('')
    expect(normalizeRepoPath('   ')).toBe('')
  })

  it('preserves a leading UNC prefix', () => {
    expect(normalizeRepoPath('\\\\server\\share')).toBe('//server/share')
  })
})

describe('parseGitConfigOriginUrl', () => {
  it('reads the origin remote url', () => {
    const cfg = `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/acme/api.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    expect(parseGitConfigOriginUrl(cfg)).toBe('https://github.com/acme/api.git')
  })

  it('ignores non-origin remotes and returns null when absent', () => {
    const cfg = `[remote "upstream"]\n\turl = https://github.com/other/api.git\n`
    expect(parseGitConfigOriginUrl(cfg)).toBeNull()
    expect(parseGitConfigOriginUrl('[core]\n')).toBeNull()
  })
})

describe('parseGitHeadBranch', () => {
  it('extracts the branch a symbolic HEAD points at', () => {
    expect(parseGitHeadBranch('ref: refs/heads/main\n')).toBe('main')
    expect(parseGitHeadBranch('ref: refs/heads/feature/x\n')).toBe('feature/x')
  })

  it('returns null for a detached HEAD (raw sha)', () => {
    expect(parseGitHeadBranch('a1b2c3d4\n')).toBeNull()
  })
})

describe('WorkspaceService', () => {
  const svc = new WorkspaceService()
  let dir: string

  beforeEach(async () => {
    dir = normalizeRepoPath(await mkdtemp(join(tmpdir(), 'rookery-ws-')))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('probes a git checkout for remote URL and default branch', async () => {
    await mkdir(join(dir, '.git'))
    await writeFile(
      join(dir, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/acme/api.git\n'
    )
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    const probe = await svc.probeRepo(dir)
    expect(probe.exists).toBe(true)
    expect(probe.isGitRepo).toBe(true)
    expect(probe.remoteUrl).toBe('https://github.com/acme/api.git')
    expect(probe.defaultBranch).toBe('main')
  })

  it('flags a non-git directory without failing', async () => {
    const probe = await svc.probeRepo(dir)
    expect(probe.exists).toBe(true)
    expect(probe.isGitRepo).toBe(false)
    expect(probe.remoteUrl).toBeNull()
  })

  it('reports a missing path as non-existent', async () => {
    const probe = await svc.probeRepo(`${dir}/does-not-exist`)
    expect(probe.exists).toBe(false)
    expect(probe.isGitRepo).toBe(false)
  })

  it('resolves a .git file (worktree/submodule) to its gitdir', async () => {
    const gitdir = join(dir, 'real-git')
    await mkdir(gitdir)
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/dev\n')
    await writeFile(join(dir, '.git'), `gitdir: ${gitdir}\n`)

    const probe = await svc.probeRepo(dir)
    expect(probe.isGitRepo).toBe(true)
    expect(probe.defaultBranch).toBe('dev')
  })

  it('autocompletes child and sibling directories', async () => {
    await mkdir(join(dir, 'apple'))
    await mkdir(join(dir, 'apricot'))
    await mkdir(join(dir, 'banana'))

    // Trailing slash → all children.
    const all = await svc.listDirs(`${dir}/`)
    expect(all).toHaveLength(3)

    // Partial segment → prefix match on siblings.
    const ap = await svc.listDirs(`${dir}/ap`)
    expect(ap.map((p) => p.split('/').pop()).sort()).toEqual(['apple', 'apricot'])
    expect(ap.every((p) => p.startsWith(dir))).toBe(true)
  })

  it('returns no suggestions for a blank or unreadable path', async () => {
    expect(await svc.listDirs('')).toEqual([])
    expect(await svc.listDirs(`${dir}/nope/deeper`)).toEqual([])
  })
})
