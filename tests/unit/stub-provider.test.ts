import { describe, expect, it } from 'vitest'
import { StubProvider } from '../../src/main/services/infra/stub-provider'

const spec = (name: string) => ({ name, template: 'api-web', repos: ['api', 'web'] })

describe('StubProvider', () => {
  it('is always available', async () => {
    expect(await new StubProvider().available()).toBe(true)
  })

  it('creates an up instance with a worktree per repo', async () => {
    const p = new StubProvider('/wt')
    const instance = await p.create(spec('rookery-abc'))
    expect(instance.state).toBe('up')
    expect(instance.worktrees.map((w) => w.repo)).toEqual(['api', 'web'])
    expect(instance.worktrees[0]!.path).toBe('/wt/rookery-abc/api')
    expect(instance.worktrees[0]!.branch).toBe('rookery-abc')
    expect(instance.containerCount).toBe(2)
  })

  it('falls back to default repos when the spec has none', async () => {
    const p = new StubProvider('/wt', ['solo'])
    const instance = await p.create({ name: 'x', template: 't' })
    expect(instance.worktrees.map((w) => w.repo)).toEqual(['solo'])
  })

  it('assigns distinct slots to concurrent instances', async () => {
    const p = new StubProvider()
    const a = await p.create(spec('a'))
    const b = await p.create(spec('b'))
    expect(a.slot).not.toBe(b.slot)
  })

  it('down stops infra; status reflects lifecycle; remove clears it', async () => {
    const p = new StubProvider()
    await p.create(spec('r'))
    expect(await p.status('r')).toBe('up')

    await p.down('r')
    expect(await p.status('r')).toBe('down')
    expect((await p.info('r'))!.containerCount).toBe(0)

    await p.up('r')
    expect(await p.status('r')).toBe('up')

    await p.remove('r')
    expect(await p.status('r')).toBe('absent')
    expect(await p.info('r')).toBeNull()
  })

  it('down/remove of an unknown instance are no-ops', async () => {
    const p = new StubProvider()
    await expect(p.down('nope')).resolves.toBeUndefined()
    await expect(p.remove('nope')).resolves.toBeUndefined()
  })
})
