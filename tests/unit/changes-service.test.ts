import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApproachDefBody } from '../../src/shared/domain'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { InfraService } from '../../src/main/services/infra-service'
import { instanceNameForFlight } from '../../src/main/services/infra'
import { StubProvider } from '../../src/main/services/infra/stub-provider'
import { ChangesService, type GitRunner, type FileReader } from '../../src/main/services/changes-service'
import { FlightStore } from '../../src/main/services/flight-store'
import { SpecService } from '../../src/main/services/spec-service'
import { BriefService } from '../../src/main/services/brief-service'
import { ApproachService } from '../../src/main/services/approach-service'
import { initFlightSnapshot } from '../../src/shared/flight-state-machine'
import { makeTestDb, type TestDb } from './helpers/test-db'

function approachBody(): ApproachDefBody {
  return {
    name: 'wf',
    description: '',
    stages: [{ id: 's0', name: 'Build', type: 'implementation', personas: [], doneCriteria: [], checkpoints: [] }],
    landing: { hold: true }
  }
}

describe('ChangesService (Phase J7.5)', () => {
  let test: TestDb
  let audit: AuditLog
  let flights: FlightStore
  let briefs: BriefService
  let approaches: ApproachService
  let infra: InfraService
  let provider: StubProvider

  /** Create an infra (or non-infra) flight and provision a matching stub instance. */
  async function makeFlight(opts: { infra: boolean }): Promise<string> {
    const wi = await briefs.create({ title: 'F', spec: 'Build it', repos: [{ name: 'api', localPath: 'C:/git/api' }] })
    const wf = await approaches.create(approachBody())
    const body = { name: wf.name, description: wf.description, stages: wf.stages, landing: wf.landing }
    const run = await flights.create({
      briefId: wi.brief.id,
      approachId: wf.id,
      approachVersion: wf.version,
      body,
      maxIterations: 3,
      maxVerificationCycles: 2,
      infraTemplate: opts.infra ? 'api-web' : null,
      teardownOnComplete: false
    })
    const snap = initFlightSnapshot(body.stages.map((s) => s.id))
    await flights.persistSnapshot(run.id, { ...snap, status: 'running' }, new Date().toISOString())
    if (opts.infra) {
      await provider.create({
        name: instanceNameForFlight(run.id),
        template: 'api-web',
        branch: instanceNameForFlight(run.id),
        base: 'main',
        repos: ['api']
      })
    }
    return run.id
  }

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    flights = new FlightStore(test.db)
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    provider = new StubProvider('/wt', ['api'])
    infra = new InfraService(provider, audit)
  })

  afterEach(() => test.close())

  it('summarises tracked numstat plus untracked new files across the worktree', async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === 'diff') return { code: 0, stdout: '12\t3\tsrc/edited.ts\n' }
      if (args[0] === 'ls-files') return { code: 0, stdout: 'src/new.ts\n' }
      return { code: 1, stdout: '' }
    }
    const reader: FileReader = async () => 'a\nb\nc\n' // 3 lines, trailing newline
    const svc = new ChangesService(infra, flights, git, reader)

    const id = await makeFlight({ infra: true })
    const result = await svc.changes(id)

    expect(result.available).toBe(true)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.files).toEqual([
      { path: 'src/edited.ts', additions: 12, deletions: 3, binary: false },
      { path: 'src/new.ts', additions: 3, deletions: 0, binary: false }
    ])
    expect(result.totalAdditions).toBe(15)
    expect(result.totalDeletions).toBe(3)
  })

  it('treats oversized/binary untracked files as binary with no counts', async () => {
    const git: GitRunner = async (args) =>
      args[0] === 'ls-files' ? { code: 0, stdout: 'blob.bin\n' } : { code: 0, stdout: '' }
    const reader: FileReader = async () => 'binary\0data'
    const svc = new ChangesService(infra, flights, git, reader)

    const id = await makeFlight({ infra: true })
    const result = await svc.changes(id)
    expect(result.repos[0]!.files).toEqual([{ path: 'blob.bin', additions: 0, deletions: 0, binary: true }])
  })

  it('is unavailable (with a reason) for a flight that provisioned no isolated workspace', async () => {
    const svc = new ChangesService(infra, flights, async () => ({ code: 0, stdout: '' }), async () => '')
    const id = await makeFlight({ infra: false })
    const result = await svc.changes(id)
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/isolated workspace/)
  })
})
