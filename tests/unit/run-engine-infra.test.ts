import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkflowDefBody } from '../../src/shared/domain'
import type { StoredEvent } from '../../src/shared/events'
import { AgentService } from '../../src/main/services/agent-service'
import { AuditLog } from '../../src/main/services/audit-log'
import { InfraService } from '../../src/main/services/infra-service'
import { instanceNameForRun } from '../../src/main/services/infra'
import { StubProvider } from '../../src/main/services/infra/stub-provider'
import { RunStore } from '../../src/main/services/run-store'
import { SpecService } from '../../src/main/services/spec-service'
import { WorkItemService } from '../../src/main/services/work-item-service'
import { WorkflowService } from '../../src/main/services/workflow-service'
import { RunEngine } from '../../src/main/engine/run-engine'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { makeTestDb, type TestDb } from './helpers/test-db'
import { fakeQuery, msg } from './helpers/fake-query'

/** setup stage (provisions infra) → implementation stage (reviewer approves). */
function workflowBody(): WorkflowDefBody {
  return {
    name: 'Feature with infra',
    description: '',
    stages: [
      { id: 'setup', name: 'Provision', type: 'setup', personas: [], passCriteria: [], gates: [] },
      {
        id: 'impl',
        name: 'Implement',
        type: 'implementation',
        personas: [{ id: 'p', name: 'Dev', role: 'Implementer', systemPrompt: 'Build it.' }],
        passCriteria: [{ id: 'c', type: 'reviewer_approves', description: '' }],
        gates: []
      }
    ]
  }
}

function approveQuery() {
  return fakeQuery([
    msg.init('claude-opus-4-8'),
    msg.assistant([{ type: 'text', text: 'done' }], { input_tokens: 10 }),
    msg.result({ result: 'APPROVE — satisfies the spec' })
  ])
}

async function waitFor(
  audit: AuditLog,
  predicate: (events: StoredEvent[]) => boolean
): Promise<StoredEvent[]> {
  for (let i = 0; i < 400; i++) {
    const events = await audit.list({ limit: 1000 })
    if (predicate(events)) return events
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('Condition not met before timeout')
}

const has = (events: StoredEvent[], type: string) => events.some((e) => e.type === type)

describe('RunEngine infra wiring (Phase 5.4)', () => {
  let test: TestDb
  let audit: AuditLog
  let provider: StubProvider
  let engine: RunEngine
  let runs: RunStore

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
    provider = new StubProvider('/wt')
  })

  afterEach(() => test.close())

  async function seed(teardownOnComplete = true) {
    const specs = new SpecService(test.db, audit)
    const workItems = new WorkItemService(test.db, audit, specs)
    const workflows = new WorkflowService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, approveQuery())
    const infra = new InfraService(provider, audit)
    engine = new RunEngine(runs, audit, agents, workItems, workflows, infra)

    const wi = await workItems.create({
      title: 'Feature',
      spec: 'Build feature X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await workflows.create(workflowBody())
    return engine.start({
      workItemId: wi.workItem.id,
      workflowId: wf.id,
      infraTemplate: 'api-web',
      teardownOnComplete
    })
  }

  it('provisions on the setup stage and runs later agents in the worktree', async () => {
    const run = await seed()
    const name = instanceNameForRun(run.id)

    const events = await waitFor(
      audit,
      (e) =>
        e.some(
          (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
        )
    )

    expect(has(events, 'infra.provisioning')).toBe(true)
    expect(has(events, 'infra.up')).toBe(true)

    // Stage agents ran inside the provisioned worktree, not the source checkout.
    const spawns = events.filter((e) => e.type === 'agent.spawned')
    expect(spawns.length).toBeGreaterThan(0)
    const cwds = spawns.map((e) => (e.payload as { cwd: string | null }).cwd)
    expect(cwds.every((cwd) => cwd === `/wt/${name}/api`)).toBe(true)
    expect(cwds).not.toContain('C:/git/api')
  })

  it('defers teardown on success so changes can be landed, then tears down on demand', async () => {
    const run = await seed(true)
    const name = instanceNameForRun(run.id)
    await waitFor(
      audit,
      (e) =>
        e.some(
          (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
        )
    )

    // A successful run keeps its infra up (Phase 6.4): the worktrees + branches
    // must survive so a human can land the change.
    expect(has(await audit.list({ limit: 1000 }), 'infra.down')).toBe(false)
    expect((await provider.info(name))!.state).toBe('up')

    // Explicit teardown (after landing/dismissal) removes it.
    await engine.teardownInfra(run.id)
    expect(await provider.info(name)).toBeNull()
    expect((await runs.get(run.id))!.status).toBe('passed')
  })

  it('leaves infra up when teardown is disabled', async () => {
    const run = await seed(false)
    const name = instanceNameForRun(run.id)
    await waitFor(
      audit,
      (e) =>
        e.some(
          (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
        )
    )
    expect(has(await audit.list({ limit: 1000 }), 'infra.down')).toBe(false)
    expect((await provider.info(name))!.state).toBe('up')
  })

  it('fails the setup stage when provisioning fails', async () => {
    provider.create = () => Promise.reject(new Error('docker unavailable'))
    const run = await seed()
    const events = await waitFor(
      audit,
      (e) =>
        e.some(
          (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'failed'
        )
    )
    expect(has(events, 'infra.failed')).toBe(true)
    expect(has(events, 'run.stage_failed')).toBe(true)
    expect((await runs.get(run.id))!.status).toBe('failed')
  })
})
