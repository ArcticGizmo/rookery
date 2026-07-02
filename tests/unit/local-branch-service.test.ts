import { beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { type GitCli, LocalBranchService } from '../../src/main/services/local-branch-service'

interface GitScript {
  insideWorkTree?: boolean
  branch?: string
  dirty?: boolean
  branchExists?: boolean
  checkoutFails?: boolean
}

/** A scripted `git` that records the commands it was asked to run. */
function fakeGit(script: GitScript): { git: GitCli; calls: string[][] } {
  const calls: string[][] = []
  const git: GitCli = async (args) => {
    calls.push(args)
    const sub = args.join(' ')
    if (sub === 'rev-parse --is-inside-work-tree') {
      return script.insideWorkTree === false
        ? { code: 128, stdout: '', stderr: 'not a git repository' }
        : { code: 0, stdout: 'true', stderr: '' }
    }
    if (sub === 'rev-parse --abbrev-ref HEAD') {
      return { code: 0, stdout: script.branch ?? 'main', stderr: '' }
    }
    if (sub === 'status --porcelain') {
      return { code: 0, stdout: script.dirty ? ' M src/file.ts' : '', stderr: '' }
    }
    if (args[0] === 'rev-parse' && args.includes('--verify')) {
      return { code: script.branchExists ? 0 : 1, stdout: '', stderr: '' }
    }
    if (args[0] === 'checkout') {
      return script.checkoutFails
        ? { code: 1, stdout: '', stderr: 'checkout failed' }
        : { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { git, calls }
}

const RUN = 'run-1'
const REPO = 'api'
const PATH = 'C:/git/api'
const BRANCH = 'rookery/feature'

describe('LocalBranchService', () => {
  let audit: AuditLog

  beforeEach(() => {
    audit = new AuditLog(new InMemoryEventStore())
  })

  async function events(): Promise<{ type: string; payload: unknown }[]> {
    return (await audit.list({ limit: 100 })).map((e) => ({ type: e.type, payload: e.payload }))
  }

  it('creates a new branch on a clean checkout and reports it ready', async () => {
    const { git, calls } = fakeGit({ branch: 'main', dirty: false, branchExists: false })
    const svc = new LocalBranchService(audit, git)

    expect(await svc.prepare(RUN, REPO, PATH, BRANCH)).toBe(true)
    // A branch that doesn't exist is created with -b.
    expect(calls).toContainEqual(['checkout', '-b', BRANCH])
    const evs = await events()
    expect(evs.map((e) => e.type)).toContain('run.branch_ready')
    expect(evs.find((e) => e.type === 'run.branch_ready')?.payload).toMatchObject({
      repo: REPO,
      branch: BRANCH,
      path: PATH
    })
  })

  it('checks out an existing branch without -b', async () => {
    const { git, calls } = fakeGit({ branch: 'main', dirty: false, branchExists: true })
    const svc = new LocalBranchService(audit, git)

    expect(await svc.prepare(RUN, REPO, PATH, BRANCH)).toBe(true)
    expect(calls).toContainEqual(['checkout', BRANCH])
    expect(calls).not.toContainEqual(['checkout', '-b', BRANCH])
  })

  it('refuses to switch onto the branch when the working tree is dirty', async () => {
    const { git, calls } = fakeGit({ branch: 'main', dirty: true, branchExists: false })
    const svc = new LocalBranchService(audit, git)

    expect(await svc.prepare(RUN, REPO, PATH, BRANCH)).toBe(false)
    // Never checks out over uncommitted work.
    expect(calls.some((c) => c[0] === 'checkout')).toBe(false)
    const evs = await events()
    expect(evs.map((e) => e.type)).toContain('run.branch_failed')
    expect(
      (evs.find((e) => e.type === 'run.branch_failed')?.payload as { message: string }).message
    ).toMatch(/uncommitted changes/)
  })

  it('is idempotent when the repo is already on the branch (allows a dirty tree)', async () => {
    // Already on BRANCH with local edits — a re-entered setup stage must not fail.
    const { git, calls } = fakeGit({ branch: BRANCH, dirty: true })
    const svc = new LocalBranchService(audit, git)

    expect(await svc.prepare(RUN, REPO, PATH, BRANCH)).toBe(true)
    // No clean-tree check and no checkout when already on the branch.
    expect(calls.some((c) => c.join(' ') === 'status --porcelain')).toBe(false)
    expect(calls.some((c) => c[0] === 'checkout')).toBe(false)
    expect((await events()).map((e) => e.type)).toContain('run.branch_ready')
  })

  it('fails cleanly when the path is not a git repository', async () => {
    const { git } = fakeGit({ insideWorkTree: false })
    const svc = new LocalBranchService(audit, git)

    expect(await svc.prepare(RUN, REPO, PATH, BRANCH)).toBe(false)
    expect((await events()).map((e) => e.type)).toContain('run.branch_failed')
  })

  it('reports git availability', async () => {
    const { git } = fakeGit({})
    expect(await new LocalBranchService(audit, git).available()).toBe(true)
  })
})
