import { describe, expect, it } from 'vitest'
import { InfraToolingMissingError } from '../../src/main/services/infra/infra-provider'
import { type CliResult, type SprigCli, SprigProvider } from '../../src/main/services/infra/sprig-provider'

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr: string, code = 1): CliResult => ({ code, stdout: '', stderr })

function makeCli(handler: (args: string[]) => CliResult | Promise<CliResult>) {
  const calls: string[][] = []
  const cli: SprigCli = async (args) => {
    calls.push(args)
    return handler(args)
  }
  return { cli, calls }
}

const infoJson = JSON.stringify({
  id: 'rookery-x',
  template: 'api-web',
  slot: 2,
  ports: { '1': 5200, '2': 5201 },
  createdAt: '2026-07-02T00:00:00Z',
  repos: [
    {
      name: 'api',
      sourcePath: '/src/api',
      worktreePath: '/wt/rookery-x/api',
      branch: 'rookery-x',
      base: 'main',
      sourceMissing: false,
      worktreeMissing: true
    }
  ],
  infra: 'up',
  containers: 3
})

describe('SprigProvider', () => {
  it('reports available when the binary resolves (any exit code)', async () => {
    const up = new SprigProvider(makeCli(() => ok('[]')).cli)
    expect(await up.available()).toBe(true)
    const errExit = new SprigProvider(makeCli(() => fail('boom')).cli)
    expect(await errExit.available()).toBe(true)
  })

  it('reports unavailable when the binary is missing', async () => {
    const provider = new SprigProvider(() => Promise.reject(new InfraToolingMissingError('missing')))
    expect(await provider.available()).toBe(false)
  })

  it('parses instance info JSON into an InfraInstance', async () => {
    const provider = new SprigProvider(makeCli(() => ok(infoJson)).cli)
    const instance = await provider.info('rookery-x')
    expect(instance).not.toBeNull()
    expect(instance!.name).toBe('rookery-x')
    expect(instance!.template).toBe('api-web')
    expect(instance!.slot).toBe(2)
    expect(instance!.state).toBe('up')
    expect(instance!.containerCount).toBe(3)
    expect(instance!.ports).toEqual([5200, 5201])
    expect(instance!.worktrees).toEqual([
      {
        repo: 'api',
        path: '/wt/rookery-x/api',
        branch: 'rookery-x',
        base: 'main',
        sourceMissing: false,
        worktreeMissing: true
      }
    ])
  })

  it('returns null info for a missing/unreadable instance', async () => {
    const notFound = new SprigProvider(makeCli(() => fail('no such instance')).cli)
    expect(await notFound.info('nope')).toBeNull()
    const garbage = new SprigProvider(makeCli(() => ok('not json')).cli)
    expect(await garbage.info('x')).toBeNull()
  })

  it('status derives from info; absent when not found', async () => {
    expect(await new SprigProvider(makeCli(() => ok(infoJson)).cli).status('rookery-x')).toBe('up')
    expect(await new SprigProvider(makeCli(() => fail('nope')).cli).status('x')).toBe('absent')
  })

  it('create passes template/base/branch and --yes, then reads back the instance', async () => {
    const { cli, calls } = makeCli((args) => (args[1] === 'info' ? ok(infoJson) : ok('created')))
    const provider = new SprigProvider(cli)
    const instance = await provider.create({
      name: 'rookery-x',
      template: 'api-web',
      base: 'main',
      branch: 'feat'
    })
    expect(instance.name).toBe('rookery-x')
    expect(calls[0]).toEqual([
      'instance',
      'create',
      'rookery-x',
      '--template',
      'api-web',
      '--base',
      'main',
      '--branch',
      'feat',
      '--yes'
    ])
    expect(calls[1]).toEqual(['instance', 'info', 'rookery-x', '--json'])
  })

  it('create throws with the CLI error on failure', async () => {
    const provider = new SprigProvider(makeCli(() => fail('branch already exists')).cli)
    await expect(provider.create({ name: 'x', template: 't' })).rejects.toThrow(
      /branch already exists/
    )
  })

  it('remove and down issue non-interactive commands', async () => {
    const { cli, calls } = makeCli(() => ok())
    const provider = new SprigProvider(cli)
    await provider.down('rookery-x')
    await provider.remove('rookery-x')
    expect(calls[0]).toEqual(['instance', 'down', 'rookery-x'])
    expect(calls[1]).toEqual(['instance', 'remove', 'rookery-x', '--yes'])
  })
})
