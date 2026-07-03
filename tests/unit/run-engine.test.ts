import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StartRunInput, ApproachDefBody } from '../../src/shared/domain'
import type { StoredEvent } from '../../src/shared/events'
import { AgentService } from '../../src/main/services/agent-service'
import { AuditLog } from '../../src/main/services/audit-log'
import { InfraService } from '../../src/main/services/infra-service'
import { type GitCli, LocalBranchService } from '../../src/main/services/local-branch-service'
import { RunStore } from '../../src/main/services/run-store'
import { SpecService } from '../../src/main/services/spec-service'
import { BriefService } from '../../src/main/services/brief-service'
import { ApproachService } from '../../src/main/services/approach-service'
import { RunEngine } from '../../src/main/engine/run-engine'
import { initRunSnapshot, reduceRun } from '../../src/shared/run-state-machine'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import type { QueryFn } from '../../src/main/agent/types'
import { makeTestDb, type TestDb } from './helpers/test-db'
import { fakeQuery, msg } from './helpers/fake-query'

function approachBody(): ApproachDefBody {
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
        checkpoints: [{ id: 'g0', kind: 'human', description: 'Approve the review' }]
      },
      { id: 's1', name: 'Setup', type: 'setup', personas: [], passCriteria: [], checkpoints: [] }
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

/**
 * A query that hangs after emitting its first messages until the stream is
 * `close()`d (which `startAgentRun` calls on cancel). Lets a test observe a run
 * mid-flight — an agent actively working — and then terminate it.
 */
function hangingQuery(): QueryFn {
  return (() => {
    let release: () => void = () => {}
    const checkpoint = new Promise<void>((r) => (release = r))
    async function* gen(): AsyncGenerator<unknown> {
      yield msg.init('claude-opus-4-8')
      yield msg.assistant([{ type: 'text', text: 'thinking' }], { input_tokens: 10 })
      await checkpoint // hang until the run is cancelled (abort → close)
    }
    const iterator = gen()
    ;(iterator as unknown as { close: () => void }).close = () => release()
    return iterator
  }) as unknown as QueryFn
}

/** Review → verification approach: stage 0 always passes, verification checkpoints on tests. */
function verificationApproach(): ApproachDefBody {
  return {
    name: 'Verified feature',
    description: '',
    stages: [
      {
        id: 's0',
        name: 'Review spec',
        type: 'review',
        personas: [{ id: 'p0', name: 'Lead', role: 'Tech Lead', systemPrompt: 'Review.' }],
        passCriteria: [],
        checkpoints: []
      },
      {
        id: 's1',
        name: 'Feature verification',
        type: 'verification',
        personas: [{ id: 'p1', name: 'Tester', role: 'Tester', systemPrompt: 'Verify.' }],
        passCriteria: [{ id: 'c1', type: 'tests_pass', description: '' }],
        checkpoints: []
      }
    ]
  }
}

/**
 * A query where the `tests_pass` checker (identified by its prompt) returns the
 * next scripted verdict on each call; every other agent returns a neutral 'ok'.
 * Lets a test fail verification on early cycles and pass on a later one.
 */
function verificationQuery(checkerVerdicts: string[]): QueryFn {
  let i = 0
  return ((args: { prompt?: string }) => {
    const isCheck = typeof args.prompt === 'string' && args.prompt.includes('automated test suite')
    const text = isCheck
      ? (checkerVerdicts[Math.min(i++, checkerVerdicts.length - 1)] ?? 'FAIL')
      : 'ok'
    async function* gen(): AsyncGenerator<unknown> {
      yield msg.init('claude-opus-4-8')
      yield msg.assistant([{ type: 'text', text }], { input_tokens: 10 })
      yield msg.result({ result: text })
    }
    const iterator = gen()
    ;(iterator as unknown as { close: () => void }).close = () => {}
    return iterator
  }) as unknown as QueryFn
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
  let briefs: BriefService
  let approaches: ApproachService

  async function setup(verdict: string, maxIterations = 3) {
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, verdictQuery(verdict))
    const infra = new InfraService(null, audit)
    engine = new RunEngine(
      runs,
      audit,
      agents,
      briefs,
      approaches,
      infra,
      new LocalBranchService(audit)
    )

    const wi = await briefs.create({
      title: 'Feature',
      spec: 'Build feature X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await approaches.create(approachBody())
    return { briefId: wi.brief.id, approachId: wf.id, maxIterations }
  }

  beforeEach(async () => {
    test = await makeTestDb()
    audit = new AuditLog(new InMemoryEventStore())
  })

  afterEach(() => test.close())

  it('runs to a human checkpoint, then completes on approval', async () => {
    const input = await setup('APPROVE — satisfies the spec')
    const run = await engine.start(input)

    await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))
    expect((await runs.get(run.id))!.status).toBe('awaiting_checkpoint')

    await engine.resolveCheckpoint({ runId: run.id, decision: 'approve', by: 'jon', note: '' })
    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
      )
    )

    expect(has(events, 'run.criterion_evaluated')).toBe(true)
    expect(has(events, 'run.checkpoint_resolved')).toBe(true)
    const detail = await runs.getDetail(run.id)
    expect(detail!.run.status).toBe('passed')
    expect(detail!.stages.every((s) => s.status === 'passed')).toBe(true)
  })

  it("records each stage persona's artifact for checkpoint review", async () => {
    const input = await setup('APPROVE — satisfies the spec')
    await engine.start(input)

    const events = await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))
    const outputs = events.filter((e) => e.type === 'run.stage_output')
    expect(outputs.length).toBeGreaterThanOrEqual(1)
    const payload = outputs[0]!.payload as { personaName: string; artifact: string }
    expect(payload.personaName).toBe('Lead')
    expect(payload.artifact).toContain('APPROVE')
  })

  it('loops then fails the run when the reviewer keeps rejecting', async () => {
    const input = await setup('REJECT — missing error handling', 2)
    const run = await engine.start(input)

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'failed'
      )
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
    await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))

    await engine.resolveCheckpoint({
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
      (e) => e.some((x) => x.type === 'run.checkpoint_awaiting') // awaits the checkpoint again after re-review
    )
  })

  // --- Phase 6.3: feature verification stage ---

  async function setupVerification(
    checkerVerdicts: string[],
    overrides: Partial<StartRunInput> = {}
  ) {
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, verificationQuery(checkerVerdicts))
    const infra = new InfraService(null, audit)
    engine = new RunEngine(
      runs,
      audit,
      agents,
      briefs,
      approaches,
      infra,
      new LocalBranchService(audit)
    )

    const wi = await briefs.create({
      title: 'Feature',
      spec: 'Build feature X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await approaches.create(verificationApproach())
    // maxIterations 1 ⇒ verification fails the whole stage on the first bad verdict
    // (no in-stage retry) so the run-level route-back behavior is what's exercised.
    return { briefId: wi.brief.id, approachId: wf.id, maxIterations: 1, ...overrides }
  }

  it('auto-routes a failed verification back to the first stage, then completes on pass', async () => {
    const input = await setupVerification(['FAIL — button is broken', 'PASS — all good'])
    const run = await engine.start(input)

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
      )
    )

    const vf = events.filter((e) => e.type === 'run.verification_failed')
    expect(vf).toHaveLength(1)
    expect((vf[0]!.payload as { routedBack: boolean }).routedBack).toBe(true)
    expect((vf[0]!.payload as { issues: string }).issues).toContain('button is broken')

    // Routed back to the first stage (re-entered ≥ twice) and finished passed.
    const s0Entries = events.filter(
      (e) => e.type === 'run.stage_entered' && (e.payload as { stageId: string }).stageId === 's0'
    )
    expect(s0Entries.length).toBeGreaterThanOrEqual(2)
    expect((await runs.get(run.id))!.status).toBe('passed')
  })

  it('escalates to a human checkpoint after exhausting the verification budget', async () => {
    const input = await setupVerification(['FAIL — still broken'], { maxVerificationCycles: 2 })
    const run = await engine.start(input)

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) =>
          x.type === 'run.verification_failed' &&
          (x.payload as { routedBack: boolean }).routedBack === false
      )
    )

    const vf = events.filter((e) => e.type === 'run.verification_failed')
    // Two automatic route-backs, then the escalation.
    expect(vf.filter((e) => (e.payload as { routedBack: boolean }).routedBack)).toHaveLength(2)
    expect(vf.filter((e) => !(e.payload as { routedBack: boolean }).routedBack)).toHaveLength(1)

    await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))
    expect((await runs.get(run.id))!.status).toBe('awaiting_checkpoint')
  })

  it('grants a fresh verification budget after human intervention', async () => {
    const input = await setupVerification(['FAIL — still broken'], { maxVerificationCycles: 1 })
    const run = await engine.start(input)

    // One auto route-back, then escalate.
    await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))

    // A human requests changes → the automatic budget resets → verification can loop again.
    await engine.resolveCheckpoint({
      runId: run.id,
      decision: 'request_changes',
      by: 'jon',
      note: 'have another go',
      targetStageIndex: 0
    })

    const events = await waitFor(
      audit,
      (e) => e.filter((x) => x.type === 'run.checkpoint_awaiting').length >= 2
    )
    const routedBack = events.filter(
      (e) =>
        e.type === 'run.verification_failed' && (e.payload as { routedBack: boolean }).routedBack
    )
    // One route-back before the first escalation, another after intervention.
    expect(routedBack.length).toBeGreaterThanOrEqual(2)
    expect(has(events, 'run.changes_requested')).toBe(true)
  })

  // --- Termination ---

  it('terminates a run paused at a human checkpoint', async () => {
    const input = await setup('APPROVE — satisfies the spec')
    const run = await engine.start(input)
    await waitFor(audit, (e) => has(e, 'run.checkpoint_awaiting'))
    expect((await runs.get(run.id))!.status).toBe('awaiting_checkpoint')

    await engine.cancel(run.id)

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'cancelled'
      )
    )
    const cancelled = events.filter((e) => e.type === 'run.cancelled')
    expect(cancelled).toHaveLength(1)
    expect((cancelled[0]!.payload as { previousStatus: string }).previousStatus).toBe(
      'awaiting_checkpoint'
    )
    expect((await runs.get(run.id))!.status).toBe('cancelled')
  })

  it('terminates an in-flight run and cancels its live agent', async () => {
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, hangingQuery())
    const infra = new InfraService(null, audit)
    engine = new RunEngine(
      runs,
      audit,
      agents,
      briefs,
      approaches,
      infra,
      new LocalBranchService(audit)
    )

    const wi = await briefs.create({
      title: 'Feature',
      spec: 'Build feature X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await approaches.create(approachBody())
    const run = await engine.start({ briefId: wi.brief.id, approachId: wf.id })

    // Wait until the agent is actually running (drive loop is live, awaiting it).
    await waitFor(audit, (e) => has(e, 'agent.spawned'))
    expect((await runs.get(run.id))!.status).toBe('running')

    await engine.cancel(run.id)

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'cancelled'
      )
    )
    // The live agent was cancelled, and the run recorded exactly one finish.
    expect(has(events, 'agent.cancelled')).toBe(true)
    expect(has(events, 'run.cancelled')).toBe(true)
    expect(
      events.filter((e) => e.type === 'run.finished').length,
      'run should finalize exactly once (no double finalize)'
    ).toBe(1)
    expect((await runs.get(run.id))!.status).toBe('cancelled')
  })

  // --- Local-branch execution mode ---

  /** A `git` that reports a clean checkout on `main` where the branch is new. */
  function successGit(): GitCli {
    return async (args) => {
      const sub = args.join(' ')
      if (sub === 'rev-parse --is-inside-work-tree') return { code: 0, stdout: 'true', stderr: '' }
      if (sub === 'rev-parse --abbrev-ref HEAD') return { code: 0, stdout: 'main', stderr: '' }
      if (sub === 'status --porcelain') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'rev-parse' && args.includes('--verify'))
        return { code: 1, stdout: '', stderr: '' } // branch doesn't exist yet
      return { code: 0, stdout: '', stderr: '' }
    }
  }

  function localBranchApproach(): ApproachDefBody {
    return {
      name: 'Local edit',
      description: '',
      stages: [
        { id: 'setup', name: 'Setup', type: 'setup', personas: [], passCriteria: [], checkpoints: [] },
        {
          id: 'impl',
          name: 'Implement',
          type: 'implementation',
          personas: [{ id: 'p', name: 'Dev', role: 'Implementer', systemPrompt: 'Build it.' }],
          passCriteria: [{ id: 'c', type: 'reviewer_approves', description: '' }],
          checkpoints: []
        }
      ]
    }
  }

  it('prepares a branch at the setup stage in local-branch mode, then completes', async () => {
    const specs = new SpecService(test.db, audit)
    briefs = new BriefService(test.db, audit, specs)
    approaches = new ApproachService(test.db, audit)
    runs = new RunStore(test.db)
    const agents = new AgentService(audit, verdictQuery('APPROVE — looks good'))
    const infra = new InfraService(null, audit)
    engine = new RunEngine(
      runs,
      audit,
      agents,
      briefs,
      approaches,
      infra,
      new LocalBranchService(audit, successGit())
    )

    const wi = await briefs.create({
      title: 'F',
      spec: 'do X',
      repos: [{ name: 'api', localPath: 'C:/git/api' }]
    })
    const wf = await approaches.create(localBranchApproach())
    const run = await engine.start({
      briefId: wi.brief.id,
      approachId: wf.id,
      executionMode: 'local_branch',
      workBranch: 'rookery/x'
    })

    const events = await waitFor(audit, (e) =>
      e.some(
        (x) => x.type === 'run.finished' && (x.payload as { status: string }).status === 'passed'
      )
    )
    expect(has(events, 'run.branch_ready')).toBe(true)
    expect(has(events, 'run.branch_failed')).toBe(false)
    expect((await runs.get(run.id))!.status).toBe('passed')
  })

  it('rejects local-branch mode without a work branch', async () => {
    const input = await setup('APPROVE')
    await expect(engine.start({ ...input, executionMode: 'local_branch' })).rejects.toThrow(
      /work branch/i
    )
  })

  // --- Phase 7.1: crash recovery ---

  it('recovers interrupted runs on boot and leaves gated runs intact', async () => {
    const input = await setup('APPROVE')
    const body = approachBody()
    const stageIds = body.stages.map((s) => s.id)
    const base = {
      briefId: input.briefId,
      approachId: input.approachId,
      approachVersion: 1,
      body,
      maxIterations: 3,
      maxVerificationCycles: 0,
      infraTemplate: null,
      teardownOnComplete: false
    }

    // Created but never advanced (crashed before START persisted).
    const pending = await runs.create(base)

    // Crashed mid-drive: persisted as `running` with no live drive loop.
    const running = await runs.create(base)
    await runs.persistSnapshot(
      running.id,
      reduceRun(initRunSnapshot(stageIds), { type: 'START' }),
      new Date().toISOString()
    )

    // Legitimately paused at a human checkpoint — must survive a restart untouched.
    const gated = await runs.create(base)
    const gatedSnap = reduceRun(reduceRun(initRunSnapshot(stageIds), { type: 'START' }), {
      type: 'GATE_AWAIT'
    })
    await runs.persistSnapshot(gated.id, gatedSnap, new Date().toISOString())

    const recovered = await engine.recoverInterruptedRuns()
    expect(recovered).toBe(2)

    expect((await runs.get(pending.id))!.status).toBe('failed')
    expect((await runs.get(running.id))!.status).toBe('failed')
    expect((await runs.get(gated.id))!.status).toBe('awaiting_checkpoint')

    const events = await audit.list({ limit: 1000 })
    const interruptedIds = events
      .filter((e) => e.type === 'run.interrupted')
      .map((e) => (e.payload as { runId: string }).runId)
      .sort()
    expect(interruptedIds).toEqual([pending.id, running.id].sort())

    // Each recovered run also emits a terminal run.finished(failed); the gated run does not.
    const finishedFailed = events.filter(
      (e) => e.type === 'run.finished' && (e.payload as { status: string }).status === 'failed'
    )
    expect(finishedFailed).toHaveLength(2)
  })
})
