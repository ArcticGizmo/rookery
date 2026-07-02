import { describe, expect, it } from 'vitest'
import {
  type CliResult,
  GitLandingProvider,
  type LandingCli
} from '../../src/main/services/landing/git-landing-provider'
import {
  type LandingSpec,
  LandingToolingMissingError
} from '../../src/main/services/landing/landing-provider'

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr: string, code = 1): CliResult => ({ code, stdout: '', stderr })

function makeCli(
  handler: (cmd: string, args: string[], cwd: string) => CliResult | Promise<CliResult>
) {
  const calls: { cmd: string; args: string[]; cwd: string }[] = []
  const cli: LandingCli = async (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd })
    return handler(cmd, args, cwd)
  }
  return { cli, calls }
}

function spec(overrides: Partial<LandingSpec> = {}): LandingSpec {
  return {
    runId: 'r1',
    repo: 'api',
    method: 'pr',
    worktreePath: '/wt/api',
    localPath: '/src/api',
    branch: 'feat',
    base: 'main',
    remoteUrl: 'https://github.com/x/api.git',
    title: 'My change',
    body: 'the body',
    ...overrides
  }
}

describe('GitLandingProvider', () => {
  it('reports available when git resolves; unavailable on spawn failure', async () => {
    expect(await new GitLandingProvider(makeCli(() => ok('git version 2')).cli).available()).toBe(
      true
    )
    const missing = new GitLandingProvider(() =>
      Promise.reject(new LandingToolingMissingError('no git'))
    )
    expect(await missing.available()).toBe(false)
  })

  it('openPr pushes the branch then runs gh pr create, returning the PR url', async () => {
    const { cli, calls } = makeCli((cmd) =>
      cmd === 'gh' ? ok('https://github.com/x/api/pull/7\n') : ok()
    )
    const result = await new GitLandingProvider(cli).openPr(spec())

    expect(calls[0]).toEqual({
      cmd: 'git',
      args: ['push', '--set-upstream', 'origin', 'feat'],
      cwd: '/wt/api'
    })
    expect(calls[1]).toEqual({
      cmd: 'gh',
      args: ['pr', 'create', '--head', 'feat', '--base', 'main', '--title', 'My change', '--body', 'the body'],
      cwd: '/wt/api'
    })
    expect(result.method).toBe('pr')
    expect(result.prUrl).toBe('https://github.com/x/api/pull/7')
  })

  it('openPr throws with the git error when the push fails', async () => {
    const provider = new GitLandingProvider(
      makeCli((cmd) => (cmd === 'git' ? fail('rejected: non-fast-forward') : ok())).cli
    )
    await expect(provider.openPr(spec())).rejects.toThrow(/non-fast-forward/)
  })

  it('openPr surfaces a missing gh CLI', async () => {
    const provider = new GitLandingProvider((cmd) =>
      cmd === 'gh'
        ? Promise.reject(new LandingToolingMissingError('gh missing'))
        : Promise.resolve(ok())
    )
    await expect(provider.openPr(spec())).rejects.toThrow(LandingToolingMissingError)
  })

  it('merge checks out the base, merges the branch, and pushes — in the primary checkout', async () => {
    const { cli, calls } = makeCli(() => ok())
    const result = await new GitLandingProvider(cli).merge(spec({ method: 'merge' }))

    expect(calls.map((c) => c.args)).toEqual([
      ['checkout', 'main'],
      ['merge', '--no-ff', 'feat', '-m', 'Land feat into main'],
      ['push', 'origin', 'main']
    ])
    expect(calls.every((c) => c.cwd === '/src/api')).toBe(true)
    expect(result.method).toBe('merge')
    expect(result.mergedInto).toBe('main')
  })

  it('merge throws when the merge conflicts', async () => {
    const provider = new GitLandingProvider(
      makeCli((_cmd, args) => (args[0] === 'merge' ? fail('CONFLICT in file.ts') : ok())).cli
    )
    await expect(provider.merge(spec({ method: 'merge' }))).rejects.toThrow(/CONFLICT/)
  })
})
