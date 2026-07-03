import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApproachDefBody } from '../../src/shared/domain'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { InfraService } from '../../src/main/services/infra-service'
import { instanceNameForRun } from '../../src/main/services/infra'
import { StubProvider } from '../../src/main/services/infra/stub-provider'
import { StubLandingProvider } from '../../src/main/services/landing/stub-landing-provider'
import { LandingService } from '../../src/main/services/landing-service'
import { RunStore } from '../../src/main/services/run-store'
import { SpecService } from '../../src/main/services/spec-service'
import { BriefService } from '../../src/main/services/brief-service'
import { ApproachService } from '../../src/main/services/approach-service'
import { initRunSnapshot } from '../../src/shared/run-state-machine'
import { makeTestDb, type TestDb } from './helpers/test-db'

function approachBody(): ApproachDefBody {
  return {
    name: 'wf',
    description: '',
    stages: [{ id: 's0', name: 'Build', type: 'implementation', personas: [], passCriteria: [], gates: [] }]
  }
}

describe('LandingService (Phase 6.4)', () => {
  let test: TestDb
  let audit: AuditLog
  let runs: RunStore
  let briefs: BriefService
  let approaches: ApproachService
  let infra: InfraService
  let provider: StubProvider
  let landingProvider: StubLandingProvider
  let landing: LandingService

  /** Create a run (optionally with infra), mark it `passed`, and provision a
   * matching stub instance so it looks like a completed, landable run. */
  async function passedRun(opts: { infra?: boolean } = { infra: true }) {
    const wi = await briefs.create({
      title: 'My feature',
      spec: 'Build it',
      repos: [{ name: 'api', localPath: 'C:/git/api', remoteUrl: 'https://github.com/x/api.git' }]
    })
    const wf = await approaches.create(approachBody())
    const body = { name: wf.name, description: wf.description, stages: wf.stages }
    const run = await runs.create({
      briefId: wi.brief.id,
      approachId: wf.id,
      approachVersion: wf.version,
      body,
      maxIterations: 3,
      maxVerificationCycles: 2,
      infraTemplate: opts.infra ? 'api-web' : null,
      teardownOnComplete: false
    })
    const snap = initRunSnapshot(body.stages.map((s) => s.id))
    await runs.persistSnapshot(run.id, { ...snap, status: 'passed' }, new Date().toISOString())
    if (opts.infra) {
      await provider.create({
        name: instanceNameForRun(run.id),
        template: 'api-web',
        branch: instanceNameForRun(run.id),
        base: 'main',
        repos: ['api']
      })
    }
    return run
  }

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    runs = new RunStore(test.db)
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    provider = new StubProvider('/wt', ['api'])
    infra = new InfraService(provider, audit)
    landingProvider = new StubLandingProvider()
    landing = new LandingService(landingProvider, audit, infra, briefs, runs)
  })

  afterEach(() => test.close())

  it('lists landable targets for a successful run with live worktrees', async () => {
    const run = await passedRun()
    const targets = await landing.targets(run.id)
    expect(targets.canLand).toBe(true)
    expect(targets.targets).toHaveLength(1)
    const t = targets.targets[0]!
    expect(t.repo).toBe('api')
    expect(t.base).toBe('main')
    expect(t.branch).toBe(instanceNameForRun(run.id))
    expect(t.localPath).toBe('C:/git/api')
    expect(t.remoteUrl).toBe('https://github.com/x/api.git')
    expect(t.landed).toBe(false)
  })

  it('opens a PR for a repo and audits the outcome', async () => {
    const run = await passedRun()

    const result = await landing.land({ runId: run.id, repo: 'api', method: 'pr', by: 'jon' })
    expect(result.prUrl).toContain('example.test')
    expect(landingProvider.calls).toHaveLength(1)
    expect(landingProvider.calls[0]!.worktreePath).toBe(`/wt/${instanceNameForRun(run.id)}/api`)
    expect(landingProvider.calls[0]!.title).toBe('My feature')

    const events = await audit.list({ runId: run.id, limit: 100 })
    expect(events.some((e) => e.type === 'run.landing_started')).toBe(true)
    expect(events.some((e) => e.type === 'run.landed')).toBe(true)

    // The repo now shows as landed.
    const after = await landing.targets(run.id)
    expect(after.targets[0]!.landed).toBe(true)
  })

  it('merges directly when asked', async () => {
    const run = await passedRun()
    const result = await landing.land({ runId: run.id, repo: 'api', method: 'merge', by: 'jon' })
    expect(result.method).toBe('merge')
    expect(result.mergedInto).toBe('main')
  })

  it('refuses to land a repo not part of the run', async () => {
    const run = await passedRun()
    await expect(landing.land({ runId: run.id, repo: 'web', method: 'pr', by: 'jon' })).rejects.toThrow(
      /not part of/
    )
  })

  it('is not landable when the run provisioned no infrastructure', async () => {
    const run = await passedRun({ infra: false })
    const targets = await landing.targets(run.id)
    expect(targets.canLand).toBe(false)
    expect(targets.reason).toMatch(/no infrastructure/i)
  })

  it('is not landable once infrastructure has been torn down', async () => {
    const run = await passedRun()
    await provider.remove(instanceNameForRun(run.id))
    const targets = await landing.targets(run.id)
    expect(targets.canLand).toBe(false)
    expect(targets.reason).toMatch(/torn down/i)
  })
})
