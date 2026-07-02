import {
  type AgentPersona,
  type GateActionInput,
  type PermissionMode,
  type Run,
  type Stage,
  type StartRunInput,
  type WorkflowDefBody,
  gateActionInputSchema,
  startRunInputSchema
} from '@shared/domain'
import type { AppEvent } from '@shared/events'
import type { RunInfra, RunInfraStatus } from '@shared/infra'
import {
  type RunSnapshot,
  initRunSnapshot,
  isTerminal,
  reduceRun,
  type RunAction
} from '@shared/run-state-machine'
import type { AgentResult } from '../agent/types'
import type { AgentService } from '../services/agent-service'
import type { AuditLog } from '../services/audit-log'
import type { InfraService } from '../services/infra-service'
import { instanceNameForRun } from '../services/infra'
import type { RunStore } from '../services/run-store'
import type { WorkItemService } from '../services/work-item-service'
import type { WorkflowService } from '../services/workflow-service'
import { evaluateCriteria } from './criteria'

interface RunCtx {
  body: WorkflowDefBody
  maxIterations: number
  spec: string
  /** Working directory for stage agents; swapped to the worktree once provisioned. */
  cwd: string | null
  /** Infra template to provision (null ⇒ no infra). */
  infraTemplate: string | null
  /** Tear infra down when the run finishes. */
  teardownOnComplete: boolean
  /** Deterministic infra instance name for this run. */
  instanceName: string
  /** Impacted repo aliases (passed to providers that build worktrees explicitly). */
  repos: string[]
  /** True once agents run inside an isolated worktree — enables autonomous edits. */
  isolated: boolean
  runAgent: (persona: AgentPersona, prompt: string, mode: PermissionMode) => Promise<AgentResult>
}

function humanGate(stage: Stage): Stage['gates'][number] | undefined {
  return stage.gates.find((gate) => gate.kind === 'human')
}

function buildImplPrompt(
  spec: string,
  stage: Stage,
  persona: AgentPersona,
  feedback: string
): string {
  return [
    `You are the ${persona.role} for the "${stage.name}" stage.`,
    `\nWork item spec:\n${spec || '(no spec provided)'}`,
    feedback ? `\nRequested changes from the previous iteration:\n${feedback}` : '',
    `\nProduce your output for this stage.`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The orchestration engine (Phase 4.3/4.6). Drives the pure run state machine:
 * runs each stage's agents, evaluates pass criteria, loops on failure up to
 * `maxIterations`, halts at human gates, and advances — auditing every
 * transition. Stage agents run read-only (`plan`) until a `setup` stage
 * provisions an isolated worktree (Phase 5.4), after which implementer agents run
 * with `acceptEdits` inside it — file edits auto-apply, but Bash/network stay
 * gated by the persona allow-list and the security deny backstop (never
 * `bypassPermissions` by default; see the Phase 5 security pass and plan §6 Q8).
 */
export class RunEngine {
  private readonly driving = new Set<string>()

  constructor(
    private readonly runs: RunStore,
    private readonly audit: AuditLog,
    private readonly agents: AgentService,
    private readonly workItems: WorkItemService,
    private readonly workflows: WorkflowService,
    private readonly infra: InfraService
  ) {}

  async start(rawInput: StartRunInput): Promise<Run> {
    const input = startRunInputSchema.parse(rawInput)
    const wf = await this.workflows.get(input.workflowId)
    if (!wf) throw new Error(`Workflow ${input.workflowId} not found`)
    const detail = await this.workItems.get(input.workItemId)
    if (!detail) throw new Error(`Work item ${input.workItemId} not found`)

    const body: WorkflowDefBody = { name: wf.name, description: wf.description, stages: wf.stages }
    const run = await this.runs.create({
      workItemId: input.workItemId,
      workflowId: wf.id,
      workflowVersion: wf.version,
      body,
      maxIterations: input.maxIterations,
      infraTemplate: input.infraTemplate ?? null,
      teardownOnComplete: input.teardownOnComplete
    })
    await this.emit(run.id, {
      type: 'run.created',
      actor: 'human',
      payload: {
        runId: run.id,
        workItemId: input.workItemId,
        workflowId: wf.id,
        workflowVersion: wf.version
      }
    })

    let snapshot = initRunSnapshot(body.stages.map((s) => s.id))
    snapshot = await this.apply(run.id, snapshot, { type: 'START' })
    await this.emit(run.id, { type: 'run.started', actor: 'system', payload: { runId: run.id } })

    const ctx = await this.buildContext(run.id)
    if (ctx) void this.drive(run.id, snapshot, ctx)
    return run
  }

  /** Resolve a pending human gate (Phase 4.4) or request changes (Phase 4.7). */
  async resolveGate(rawInput: GateActionInput): Promise<void> {
    const input = gateActionInputSchema.parse(rawInput)
    const run = await this.runs.get(input.runId)
    if (!run) throw new Error(`Run ${input.runId} not found`)
    if (run.status !== 'awaiting_gate') throw new Error('Run is not awaiting a gate')

    let snapshot = await this.runs.loadSnapshot(input.runId)
    const ctx = await this.buildContext(input.runId)
    if (!snapshot || !ctx) throw new Error('Run state missing')
    const gatedIndex = snapshot.currentStageIndex
    const stage = ctx.body.stages[gatedIndex]

    await this.emit(
      input.runId,
      {
        type: 'run.gate_resolved',
        actor: 'human',
        payload: {
          runId: input.runId,
          stageId: stage?.id ?? '',
          decision: input.decision,
          by: input.by,
          note: input.note
        }
      },
      stage?.id
    )

    if (input.decision === 'approve') {
      snapshot = await this.apply(input.runId, snapshot, { type: 'GATE_APPROVE' })
      if (stage) {
        await this.emit(
          input.runId,
          {
            type: 'run.stage_passed',
            actor: 'system',
            payload: { runId: input.runId, stageId: stage.id, stageIndex: gatedIndex }
          },
          stage.id
        )
      }
    } else if (input.decision === 'reject') {
      snapshot = await this.apply(input.runId, snapshot, { type: 'GATE_REJECT' })
    } else {
      const targetIndex = input.targetStageIndex ?? 0
      snapshot = await this.apply(input.runId, snapshot, { type: 'REQUEST_CHANGES', targetIndex })
      await this.emit(input.runId, {
        type: 'run.changes_requested',
        actor: 'human',
        payload: {
          runId: input.runId,
          targetStageIndex: targetIndex,
          by: input.by,
          note: input.note
        }
      })
    }

    if (snapshot.status === 'running') {
      void this.drive(input.runId, snapshot, ctx)
    } else if (isTerminal(snapshot.status)) {
      await this.finalize(input.runId, ctx, snapshot.status)
    }
  }

  /** Live infrastructure status for a run, for the run view (Phase 5.5). */
  async runInfra(runId: string): Promise<RunInfra> {
    const provider = this.infra.providerName()
    if (!this.infra.isConfigured()) {
      return {
        runId,
        provider,
        providerAvailable: false,
        instanceName: null,
        status: 'none',
        instance: null
      }
    }
    const instanceName = instanceNameForRun(runId)
    const providerAvailable = await this.infra.available()
    const instance = providerAvailable
      ? await this.infra.info(instanceName).catch(() => null)
      : null
    let status: RunInfraStatus = 'none'
    if (instance) status = instance.state === 'up' ? 'up' : 'down'
    return { runId, provider, providerAvailable, instanceName, status, instance }
  }

  private async buildContext(runId: string): Promise<RunCtx | null> {
    const rc = await this.runs.getContext(runId)
    if (!rc) return null
    const detail = await this.workItems.get(rc.workItemId)
    const spec = detail?.currentSpec?.content ?? ''
    const instanceName = instanceNameForRun(runId)

    const ctx: RunCtx = {
      body: rc.body,
      maxIterations: rc.maxIterations,
      spec,
      cwd: detail?.repos[0]?.localPath ?? null,
      infraTemplate: rc.infraTemplate,
      teardownOnComplete: rc.teardownOnComplete,
      instanceName,
      repos: detail?.repos.map((r) => r.name) ?? [],
      isolated: false,
      // Read cwd lazily so it reflects the worktree once setup provisions it.
      runAgent: (persona, prompt, mode) =>
        this.agents.run({ persona, prompt, cwd: ctx.cwd, permissionMode: mode }, { runId })
    }

    // Recover the worktree cwd after a pause (e.g. a human gate) rebuilds the
    // context: if this run already has a live instance, point agents back at it.
    if (rc.infraTemplate && this.infra.isConfigured()) {
      const instance = await this.infra.info(instanceName).catch(() => null)
      const worktree = instance?.worktrees[0]
      if (worktree) {
        ctx.cwd = worktree.path
        ctx.isolated = true
      }
    }
    return ctx
  }

  /**
   * Ensure the run's infra is provisioned before a `setup` stage runs (Phase
   * 5.4). No-op when the run requested no template or no provider is configured.
   * Reuses an existing instance (e.g. on a re-entered setup stage) rather than
   * recreating it. On success, points stage agents at the worktree; returns
   * false if provisioning failed (the caller fails the stage).
   */
  private async ensureInfra(runId: string, ctx: RunCtx): Promise<boolean> {
    if (!ctx.infraTemplate || !this.infra.isConfigured()) return true
    const existing = await this.infra.info(ctx.instanceName).catch(() => null)
    try {
      const instance =
        existing ??
        (await this.infra.provision(runId, {
          name: ctx.instanceName,
          template: ctx.infraTemplate,
          branch: ctx.instanceName,
          repos: ctx.repos
        }))
      const worktree = instance.worktrees[0]
      if (worktree) {
        ctx.cwd = worktree.path
        ctx.isolated = true
      }
      return true
    } catch {
      // provision() has already emitted infra.failed.
      return false
    }
  }

  /** Emit run.finished and tear down the run's infra when configured to. */
  private async finalize(runId: string, ctx: RunCtx, status: string): Promise<void> {
    await this.emit(runId, {
      type: 'run.finished',
      actor: 'system',
      payload: { runId, status }
    })
    if (ctx.infraTemplate && ctx.teardownOnComplete && this.infra.isConfigured()) {
      await this.infra.teardown(runId, ctx.instanceName, { remove: true })
    }
  }

  private async drive(runId: string, initial: RunSnapshot, ctx: RunCtx): Promise<void> {
    if (this.driving.has(runId)) return
    this.driving.add(runId)
    let snapshot = initial
    try {
      while (snapshot.status === 'running') {
        const index = snapshot.currentStageIndex
        const stage = ctx.body.stages[index]
        if (!stage) {
          snapshot = await this.apply(runId, snapshot, { type: 'STAGE_FAILED' })
          break
        }

        await this.emit(
          runId,
          {
            type: 'run.stage_entered',
            actor: 'system',
            payload: {
              runId,
              stageId: stage.id,
              stageName: stage.name,
              stageIndex: index,
              iteration: snapshot.stages[index]!.iteration
            }
          },
          stage.id
        )

        // A setup stage provisions the run's isolated worktrees + infra first.
        if (stage.type === 'setup' && !(await this.ensureInfra(runId, ctx))) {
          snapshot = await this.apply(runId, snapshot, { type: 'STAGE_FAILED' })
          await this.emit(
            runId,
            {
              type: 'run.stage_failed',
              actor: 'system',
              payload: {
                runId,
                stageId: stage.id,
                stageIndex: index,
                reason: 'Infrastructure provisioning failed'
              }
            },
            stage.id
          )
          continue
        }

        const outcome = await this.runStage(runId, snapshot, stage, ctx)
        snapshot = outcome.snapshot

        if (outcome.passed) {
          const gate = humanGate(stage)
          if (gate) {
            snapshot = await this.apply(runId, snapshot, { type: 'GATE_AWAIT' })
            await this.emit(
              runId,
              {
                type: 'run.gate_awaiting',
                actor: 'system',
                payload: {
                  runId,
                  stageId: stage.id,
                  gateId: gate.id,
                  description: gate.description
                }
              },
              stage.id
            )
            return // pause for a human
          }
          snapshot = await this.apply(runId, snapshot, { type: 'STAGE_PASSED' })
          await this.emit(
            runId,
            {
              type: 'run.stage_passed',
              actor: 'system',
              payload: { runId, stageId: stage.id, stageIndex: index }
            },
            stage.id
          )
        } else {
          snapshot = await this.apply(runId, snapshot, { type: 'STAGE_FAILED' })
          await this.emit(
            runId,
            {
              type: 'run.stage_failed',
              actor: 'system',
              payload: { runId, stageId: stage.id, stageIndex: index, reason: outcome.reason }
            },
            stage.id
          )
        }
      }

      if (isTerminal(snapshot.status)) {
        await this.finalize(runId, ctx, snapshot.status)
      }
    } catch (error) {
      await this.runs.persistSnapshot(
        runId,
        reduceRun(snapshot, { type: 'STAGE_FAILED' }),
        new Date().toISOString()
      )
      await this.finalize(runId, ctx, 'failed')
      console.error('Run engine error:', error)
    } finally {
      this.driving.delete(runId)
    }
  }

  /** Run one stage's agents + criteria, looping on failure up to maxIterations. */
  private async runStage(
    runId: string,
    snapshot: RunSnapshot,
    stage: Stage,
    ctx: RunCtx
  ): Promise<{ snapshot: RunSnapshot; passed: boolean; reason: string }> {
    let current = snapshot
    let feedback = ''

    for (;;) {
      const index = current.currentStageIndex
      const iteration = current.stages[index]!.iteration

      // Inside an isolated worktree, implementer agents may auto-apply file edits
      // (Bash/network still gated by allow-list + deny backstop); otherwise they
      // stay read-only until a setup stage isolates them.
      const mode: PermissionMode = ctx.isolated ? 'acceptEdits' : 'plan'
      const agentResults: AgentResult[] = []
      for (const persona of stage.personas) {
        agentResults.push(
          await ctx.runAgent(persona, buildImplPrompt(ctx.spec, stage, persona, feedback), mode)
        )
      }

      const outcomes = await evaluateCriteria(stage, {
        spec: ctx.spec,
        cwd: ctx.cwd,
        agentResults,
        runAgent: ctx.runAgent
      })
      for (const outcome of outcomes) {
        await this.emit(
          runId,
          {
            type: 'run.criterion_evaluated',
            actor: 'system',
            payload: {
              runId,
              stageId: stage.id,
              criterionId: outcome.criterion.id,
              criterionType: outcome.criterion.type,
              passed: outcome.passed,
              detail: outcome.detail
            }
          },
          stage.id
        )
      }

      if (outcomes.every((o) => o.passed)) return { snapshot: current, passed: true, reason: '' }

      const failures = outcomes.filter((o) => !o.passed)
      if (iteration >= ctx.maxIterations) {
        return {
          snapshot: current,
          passed: false,
          reason:
            failures.map((o) => `${o.criterion.type}: ${o.detail}`).join('; ') || 'criteria not met'
        }
      }

      feedback = failures.map((o) => `- ${o.criterion.type}: ${o.detail}`).join('\n')
      current = await this.apply(runId, current, { type: 'RETRY' })
      await this.emit(
        runId,
        {
          type: 'run.stage_entered',
          actor: 'system',
          payload: {
            runId,
            stageId: stage.id,
            stageName: stage.name,
            stageIndex: index,
            iteration: current.stages[index]!.iteration
          }
        },
        stage.id
      )
    }
  }

  private async apply(
    runId: string,
    snapshot: RunSnapshot,
    action: RunAction
  ): Promise<RunSnapshot> {
    const next = reduceRun(snapshot, action)
    await this.runs.persistSnapshot(runId, next, new Date().toISOString())
    return next
  }

  private async emit(runId: string, event: AppEvent, stageId?: string | null): Promise<void> {
    try {
      await this.audit.append({ ...event, runId, stageId: stageId ?? null })
    } catch (error) {
      console.error('Failed to append run event:', error)
    }
  }
}
