import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkflowDefBody } from '../../src/shared/domain'
import type { StoredEvent } from '../../src/shared/events'
import { AgentService } from '../../src/main/services/agent-service'
import { AuditLog } from '../../src/main/services/audit-log'
import { InfraService } from '../../src/main/services/infra-service'
import { RunStore } from '../../src/main/services/run-store'
import { SpecService } from '../../src/main/services/spec-service'
import { WorkItemService } from '../../src/main/services/work-item-service'
import { WorkflowService } from '../../src/main/services/workflow-service'
import { RunEngine } from '../../src/main/engine/run-engine'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { makeTestDb, type TestDb } from './helpers/test-db'
import { fakeQuery, msg } from './helpers/fake-query'

function workflowBody(): WorkflowDefBody {
  return {
    name: 'Basic feature',
    description: '',
    stages: [
      {
        id: 's0',
        name: 'Review spec',
        type: 'review',
        personas: [{ id: 'p0', name: 'Lead', role: 'Tech Lead', systemPrompt: 'Review the spec.' }],
        passCriteria: [{ id: 'c0', type: 'reviewer_approves', description: '' }],
        gates: [{ id: 'g0', kind: 'human', description: 'Approve the review' }]
      },
      { id: 's1', name: 'Setup', type: 'setup', personas: [], passCriteria: [], gates: [] }
    ]
  }
}

/** A query that makes every agent (implementer + reviewer) return `verdict`. */
function verdictQuery(verdict: string) {
  return fakeQuery([
    msg.init('claude-opus-4-8'),
    msg.assistant([{ type: 'text', text: 'working' }], { input_tokens: 10 }),
    msg.result({ result: verdict })
  ])
}

async function waitFor(
  audit: AuditLog,
  predicate: (events: StoredEvent[]) => boolean
): Promise<StoredEvent[]> {
  for (let i = 0; i < 300; i++) {
    const events = await audit.list({ limit: 1000 })
    if (predicate(events)) return events
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('Condition not met before timeout')
}

const has = (events: StoredEvent[], type: string) => events.some((e) => e.type === type)

describe('RunEngine', () => {
  let test: TestDb
  let audit: AuditLog
  let engine: RunEngine
  let runs: RunStore
  let workItems: WorkItemService
  let workflows: WorkflowService

  async function setup(verdict: string, maxIterations = 3) {
    const specs = new SpecService(test.db, audit)
    workItems = new WorkItemService(test.db, audit, specs)
    workflows = new WorkflowService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, verdictQuery(verdict))
    const infra = new InfraService(null, audit)
    engine = new RunEngine(runs, audit, agents, workItems, workflows, infra)

    const wi = await workItems.create({
      title: 'Feature',
      spec: 'Build feature X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await workflows.create(workflowBody())
    return { workItemId: wi.workItem.id, workflowId: wf.id, maxIterations }
  }

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
  })

  afterEach(() => test.close())

  it('runs to a human gate, then completes on approval', async () => {
    const input = await setup('APPROVE — satisfies the spec')
    const run = await engine.start(input)

    await waitFor(audit, (e) => has(e, 'run.gate_awaiting'))
    expect((await runs.get(run.id))!.status).toBe('awaiting_gate')

    await engine.resolveGate({ runId: run.id, decision: 'approve', by: 'jon', note: '' })
    const events = await waitFor(
      audit,
      (e) => e.some((x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed')
    )

    expect(has(events, 'run.criterion_evaluated')).toBe(true)
    expect(has(events, 'run.gate_resolved')).toBe(true)
    const detail = await runs.getDetail(run.id)
    expect(detail!.run.status).toBe('passed')
    expect(detail!.stages.every((s) => s.status === 'passed')).toBe(true)
  })

  it('loops then fails the run when the reviewer keeps rejecting', async () => {
    const input = await setup('REJECT — missing error handling', 2)
    const run = await engine.start(input)

    const events = await waitFor(
      audit,
      (e) => e.some((x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'failed')
    )

    // Stage re-entered for a second iteration before failing.
    const entered = events.filter(
      (e) => e.type === 'run.stage_entered' && (e.payload as { stageId: string }).stageId === 's0'
    )
    expect(entered.length).toBeGreaterThanOrEqual(2)
    expect(has(events, 'run.stage_failed')).toBe(true)
    expect((await runs.get(run.id))!.status).toBe('failed')
  })

  it('routes back to an earlier stage on request-changes', async () => {
    const input = await setup('APPROVE — ok')
    const run = await engine.start(input)
    await waitFor(audit, (e) => has(e, 'run.gate_awaiting'))

    await engine.resolveGate({
      runId: run.id,
      decision: 'request_changes',
      by: 'jon',
      note: 'Tighten the spec',
      targetStageIndex: 0
    })

    const events = await waitFor(audit, (e) => has(e, 'run.changes_requested'))
    expect(events.some((e) => e.type === 'run.changes_requested')).toBe(true)
    // It re-enters stage 0 and, with an approving reviewer, completes.
    await waitFor(
      audit,
      (e) => e.some((x) => x.type === 'run.gate_awaiting') // awaits the gate again after re-review
    )
  })
})
