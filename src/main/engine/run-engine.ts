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
import type { RunStore } from '../services/run-store'
import type { WorkItemService } from '../services/work-item-service'
import type { WorkflowService } from '../services/workflow-service'
import { evaluateCriteria } from './criteria'

interface RunCtx {
  body: WorkflowDefBody
  maxIterations: number
  spec: string
  cwd: string | null
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
 * transition. Stage agents run read-only (`plan`) until worktrees arrive in
 * Phase 5; the `tests_pass` criterion executes and opts into `bypassPermissions`.
 */
export class RunEngine {
  private readonly driving = new Set<string>()

  constructor(
    private readonly runs: RunStore,
    private readonly audit: AuditLog,
    private readonly agents: AgentService,
    private readonly workItems: WorkItemService,
    private readonly workflows: WorkflowService
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
      maxIterations: input.maxIterations
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
      await this.emit(input.runId, {
        type: 'run.finished',
        actor: 'system',
        payload: { runId: input.runId, status: snapshot.status }
      })
    }
  }

  private async buildContext(runId: string): Promise<RunCtx | null> {
    const rc = await this.runs.getContext(runId)
    if (!rc) return null
    const detail = await this.workItems.get(rc.workItemId)
    const spec = detail?.currentSpec?.content ?? ''
    const cwd = detail?.repos[0]?.localPath ?? null
    return {
      body: rc.body,
      maxIterations: rc.maxIterations,
      spec,
      cwd,
      runAgent: (persona, prompt, mode) =>
        this.agents.run({ persona, prompt, cwd, permissionMode: mode }, { runId })
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
        await this.emit(runId, {
          type: 'run.finished',
          actor: 'system',
          payload: { runId, status: snapshot.status }
        })
      }
    } catch (error) {
      await this.emit(runId, {
        type: 'run.finished',
        actor: 'system',
        payload: { runId, status: 'failed' }
      })
      await this.runs.persistSnapshot(
        runId,
        reduceRun(snapshot, { type: 'STAGE_FAILED' }),
        new Date().toISOString()
      )
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

      const agentResults: AgentResult[] = []
      for (const persona of stage.personas) {
        agentResults.push(
          await ctx.runAgent(persona, buildImplPrompt(ctx.spec, stage, persona, feedback), 'plan')
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
