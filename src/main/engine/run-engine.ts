import {
  type AgentPersona,
  type CheckpointActionInput,
  type PermissionMode,
  type Run,
  type RunExecutionMode,
  type Stage,
  type StartRunInput,
  type ApproachDefBody,
  checkpointActionInputSchema,
  resolveExecutionMode,
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
import type { LocalBranchService } from '../services/local-branch-service'
import { instanceNameForRun } from '../services/infra'
import type { RunStore } from '../services/run-store'
import type { BriefService } from '../services/brief-service'
import type { ApproachService } from '../services/approach-service'
import { evaluateCriteria } from './criteria'

interface RunCtx {
  body: ApproachDefBody
  maxIterations: number
  /** Automatic verification→fix route-backs allowed before human escalation (Phase 6.3). */
  maxVerificationCycles: number
  /** Route-backs already taken in the current budget window (rehydrated from the log). */
  verificationCycles: number
  /** Issues recorded by the last failed verification, fed into re-run prompts. */
  verificationFeedback: string
  spec: string
  /** Working directory for stage agents; swapped to the worktree once provisioned. */
  cwd: string | null
  /** Infra template to provision (null ⇒ no infra). */
  infraTemplate: string | null
  /** Tear infra down when the run finishes. */
  teardownOnComplete: boolean
  /** How stage agents get write access (drives what the setup stage provisions). */
  executionMode: RunExecutionMode
  /** Branch to create/checkout on the repo for `local_branch` mode. */
  workBranch: string | null
  /** Deterministic infra instance name for this run. */
  instanceName: string
  /** Impacted repo aliases (passed to providers that build worktrees explicitly). */
  repos: string[]
  /** True once agents run inside an isolated worktree — enables autonomous edits. */
  isolated: boolean
  runAgent: (persona: AgentPersona, prompt: string, mode: PermissionMode) => Promise<AgentResult>
}

function humanCheckpoint(stage: Stage): Stage['checkpoints'][number] | undefined {
  return stage.checkpoints.find((checkpoint) => checkpoint.kind === 'human')
}

function buildImplPrompt(
  spec: string,
  stage: Stage,
  persona: AgentPersona,
  feedback: string,
  verificationFeedback: string
): string {
  return [
    `You are the ${persona.role} for the "${stage.name}" stage.`,
    `\nWork item spec:\n${spec || '(no spec provided)'}`,
    verificationFeedback
      ? `\nKnown issues from a previous feature-verification cycle — make sure these are ` +
        `addressed:\n${verificationFeedback}`
      : '',
    feedback ? `\nRequested changes from the previous iteration:\n${feedback}` : '',
    `\nProduce your output for this stage.`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The orchestration engine (Phase 4.3/4.6). Drives the pure run state machine:
 * runs each stage's agents, evaluates pass criteria, loops on failure up to
 * `maxIterations`, halts at human checkpoints, and advances — auditing every
 * transition. Stage agents run read-only (`plan`) until a `setup` stage
 * provisions an isolated worktree (Phase 5.4), after which implementer agents run
 * with `acceptEdits` inside it — file edits auto-apply, but Bash/network stay
 * gated by the persona allow-list and the security deny backstop (never
 * `bypassPermissions` by default; see the Phase 5 security pass and plan §6 Q8).
 */
export class RunEngine {
  private readonly driving = new Set<string>()
  /** Runs a human has asked to terminate; observed by the drive/stage loops. */
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly runs: RunStore,
    private readonly audit: AuditLog,
    private readonly agents: AgentService,
    private readonly briefs: BriefService,
    private readonly approaches: ApproachService,
    private readonly infra: InfraService,
    private readonly localBranch: LocalBranchService
  ) {}

  async start(rawInput: StartRunInput): Promise<Run> {
    const input = startRunInputSchema.parse(rawInput)
    const wf = await this.approaches.get(input.approachId)
    if (!wf) throw new Error(`Approach ${input.approachId} not found`)
    const detail = await this.briefs.get(input.briefId)
    if (!detail) throw new Error(`Work item ${input.briefId} not found`)

    const executionMode = resolveExecutionMode(input)
    if (executionMode === 'local_branch') {
      if (!input.workBranch?.trim()) {
        throw new Error('A work branch is required for local-branch execution mode.')
      }
      if (!detail.repos[0]?.localPath) {
        throw new Error('Local-branch execution mode needs the work item to have a repo attached.')
      }
    }

    const body: ApproachDefBody = { name: wf.name, description: wf.description, stages: wf.stages }
    const run = await this.runs.create({
      briefId: input.briefId,
      approachId: wf.id,
      approachVersion: wf.version,
      body,
      maxIterations: input.maxIterations,
      maxVerificationCycles: input.maxVerificationCycles,
      infraTemplate: input.infraTemplate ?? null,
      teardownOnComplete: input.teardownOnComplete,
      executionMode: input.executionMode ?? null,
      workBranch: input.workBranch?.trim() ?? null
    })
    await this.emit(run.id, {
      type: 'run.created',
      actor: 'human',
      payload: {
        runId: run.id,
        briefId: input.briefId,
        approachId: wf.id,
        approachVersion: wf.version
      }
    })

    let snapshot = initRunSnapshot(body.stages.map((s) => s.id))
    snapshot = await this.apply(run.id, snapshot, { type: 'START' })
    await this.emit(run.id, { type: 'run.started', actor: 'system', payload: { runId: run.id } })

    const ctx = await this.buildContext(run.id)
    if (ctx) void this.drive(run.id, snapshot, ctx)
    return run
  }

  /**
   * Reconcile runs left mid-flight by a crash or unclean shutdown (Phase 7.1).
   * The in-memory `drive` loop does not survive a restart, so any run still
   * persisted as `running` or `pending` is orphaned — nothing is advancing it.
   * Fail those cleanly with an audited reason so the log stays honest and the UI
   * never shows a phantom "running" run. `awaiting_checkpoint` runs are a legitimate
   * pause for a human and survive a restart untouched (resolving the checkpoint
   * rebuilds their context). Returns the number of runs recovered.
   *
   * Runs on boot, before the window loads. Infra is intentionally left as-is:
   * its real state after a crash is unknown, so teardown is left to the user
   * rather than guessed at here.
   */
  async recoverInterruptedRuns(): Promise<number> {
    const all = await this.runs.list()
    const orphaned = all.filter((r) => r.status === 'running' || r.status === 'pending')
    for (const run of orphaned) {
      const snapshot = await this.runs.loadSnapshot(run.id)
      if (!snapshot) continue
      const failed = reduceRun(snapshot, { type: 'STAGE_FAILED' })
      await this.runs.persistSnapshot(run.id, failed, new Date().toISOString())
      await this.emit(run.id, {
        type: 'run.interrupted',
        actor: 'system',
        payload: {
          runId: run.id,
          previousStatus: run.status,
          reason: 'Interrupted by an app restart or unclean shutdown; failed on recovery.'
        }
      })
      await this.emit(run.id, {
        type: 'run.finished',
        actor: 'system',
        payload: { runId: run.id, status: 'failed' }
      })
    }
    return orphaned.length
  }

  /** Resolve a pending human checkpoint (Phase 4.4) or request changes (Phase 4.7). */
  async resolveCheckpoint(rawInput: CheckpointActionInput): Promise<void> {
    const input = checkpointActionInputSchema.parse(rawInput)
    const run = await this.runs.get(input.runId)
    if (!run) throw new Error(`Run ${input.runId} not found`)
    if (run.status !== 'awaiting_checkpoint') throw new Error('Run is not awaiting a checkpoint')

    let snapshot = await this.runs.loadSnapshot(input.runId)
    const ctx = await this.buildContext(input.runId)
    if (!snapshot || !ctx) throw new Error('Run state missing')
    const gatedIndex = snapshot.currentStageIndex
    const stage = ctx.body.stages[gatedIndex]

    await this.emit(
      input.runId,
      {
        type: 'run.checkpoint_resolved',
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
      // Human intervention resets the automatic verification budget (Phase 6.3), so
      // an escalated run gets a fresh set of route-backs after a person steps in.
      ctx.verificationCycles = 0
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

  /**
   * Terminate an in-flight run at a human's request. Cancels the run's live
   * agents immediately and drives the run to `cancelled`, auditing the human
   * action and the terminal transition. No-op on a run that has already reached
   * a terminal state.
   *
   * When a drive loop is active it registers itself synchronously in `driving`
   * (see `start`/`resolveCheckpoint`), so we can hand off the terminal transition to
   * it: the loop observes the `cancelled` flag, applies CANCEL, breaks, and
   * finalizes — avoiding a double finalize. A paused run (e.g. `awaiting_checkpoint`)
   * has no loop, so we apply CANCEL and finalize here.
   */
  async cancel(runId: string): Promise<void> {
    const run = await this.runs.get(runId)
    if (!run) throw new Error(`Run ${runId} not found`)
    if (isTerminal(run.status)) return

    this.cancelled.add(runId)
    this.agents.cancelByRun(runId)
    await this.emit(runId, {
      type: 'run.cancelled',
      actor: 'human',
      payload: { runId, previousStatus: run.status }
    })

    if (this.driving.has(runId)) return // active loop finalizes and clears the flag

    const snapshot = await this.runs.loadSnapshot(runId)
    const ctx = await this.buildContext(runId)
    if (snapshot && ctx) {
      const next = await this.apply(runId, snapshot, { type: 'CANCEL' })
      await this.finalize(runId, ctx, next.status)
    }
    this.cancelled.delete(runId)
  }

  /**
   * Cancel every run that hasn't reached a terminal state. Used by the debug
   * data-reset tool so live agents are stopped before their rows are wiped —
   * otherwise a still-running drive loop would keep emitting events into the
   * freshly-cleared log. Best-effort: a failure to cancel one run must not stop
   * the others (or the reset). Returns the number of runs cancelled.
   */
  async cancelAllInFlight(): Promise<number> {
    const all = await this.runs.list()
    const inFlight = all.filter((r) => !isTerminal(r.status))
    for (const run of inFlight) {
      await this.cancel(run.id).catch((error) =>
        console.error(`Failed to cancel run ${run.id} during reset:`, error)
      )
    }
    return inFlight.length
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
    const detail = await this.briefs.get(rc.briefId)
    const spec = detail?.currentSpec?.content ?? ''
    const instanceName = instanceNameForRun(runId)

    const ctx: RunCtx = {
      body: rc.body,
      maxIterations: rc.maxIterations,
      maxVerificationCycles: rc.maxVerificationCycles,
      verificationCycles: 0,
      verificationFeedback: '',
      spec,
      cwd: detail?.repos[0]?.localPath ?? null,
      infraTemplate: rc.infraTemplate,
      teardownOnComplete: rc.teardownOnComplete,
      executionMode: resolveExecutionMode({
        executionMode: rc.executionMode ?? undefined,
        infraTemplate: rc.infraTemplate
      }),
      workBranch: rc.workBranch,
      instanceName,
      repos: detail?.repos.map((r) => r.name) ?? [],
      isolated: false,
      // Read cwd lazily so it reflects the worktree once setup provisions it.
      runAgent: (persona, prompt, mode) =>
        this.agents.run({ persona, prompt, cwd: ctx.cwd, permissionMode: mode }, { runId })
    }

    // Rehydrate the verification safeguard from the log (the source of truth) so it
    // survives a pause — e.g. a human checkpoint — that rebuilds this context. A human
    // `request_changes` resets the automatic budget: only route-backs recorded
    // after the most recent one count toward the cap.
    const events = await this.audit.list({ runId, limit: 1000 })
    const baselineId = events.reduce(
      (max, e) => (e.type === 'run.changes_requested' && e.id > max ? e.id : max),
      0
    )
    for (const e of events) {
      if (e.type !== 'run.verification_failed') continue
      const p = e.payload as { issues?: string; routedBack?: boolean }
      ctx.verificationFeedback = p.issues ?? ctx.verificationFeedback
      if (p.routedBack && e.id > baselineId) ctx.verificationCycles += 1
    }

    // Recover isolation after a pause (e.g. a human checkpoint) rebuilds the context.
    if (ctx.executionMode === 'infra' && rc.infraTemplate && this.infra.isConfigured()) {
      // Infra: point agents back at the live worktree if one exists.
      const instance = await this.infra.info(instanceName).catch(() => null)
      const worktree = instance?.worktrees[0]
      if (worktree) {
        ctx.cwd = worktree.path
        ctx.isolated = true
      }
    } else if (ctx.executionMode === 'local_branch' && ctx.workBranch && ctx.cwd) {
      // Local branch: agents already edit in-place on the repo checkout, so it's
      // isolated once the repo is on the run's branch (setup stage did the switch).
      if ((await this.localBranch.currentBranch(ctx.cwd)) === ctx.workBranch) {
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

  /**
   * Prepare a `local_branch` run's write path before its `setup` stage runs:
   * check out the run's branch on the work item's own repo checkout so implementer
   * agents can edit in place — no sprig or Docker. On success, isolation is on and
   * agents edit the real checkout on that branch; returns false (failing the
   * stage) if the branch couldn't be prepared (e.g. dirty tree, missing git).
   */
  private async ensureLocalBranch(runId: string, ctx: RunCtx): Promise<boolean> {
    if (!ctx.workBranch || !ctx.cwd) return false
    const repo = ctx.repos[0] ?? 'repo'
    const ok = await this.localBranch.prepare(runId, repo, ctx.cwd, ctx.workBranch)
    if (ok) ctx.isolated = true
    return ok
  }

  /**
   * Provision whatever a `setup` stage needs for the run's execution mode: an
   * isolated worktree (`infra`), a branch on the real checkout (`local_branch`),
   * or nothing (`read_only`). Returns false if provisioning failed.
   */
  private ensureSetup(runId: string, ctx: RunCtx): Promise<boolean> {
    if (ctx.executionMode === 'infra') return this.ensureInfra(runId, ctx)
    if (ctx.executionMode === 'local_branch') return this.ensureLocalBranch(runId, ctx)
    return Promise.resolve(true)
  }

  /**
   * Emit run.finished and tear down the run's infra when configured to. A
   * *successful* run defers teardown (Phase 6.4): its worktrees + branches must
   * survive so a human can land the change (open a PR / merge). Teardown then
   * happens on demand via `teardownInfra`. Failed/cancelled runs tear down
   * immediately as before.
   */
  private async finalize(runId: string, ctx: RunCtx, status: string): Promise<void> {
    await this.emit(runId, {
      type: 'run.finished',
      actor: 'system',
      payload: { runId, status }
    })
    if (
      status !== 'passed' &&
      ctx.infraTemplate &&
      ctx.teardownOnComplete &&
      this.infra.isConfigured()
    ) {
      await this.infra.teardown(runId, ctx.instanceName, { remove: true })
    }
  }

  /**
   * Tear down a run's infrastructure on demand (Phase 6.4) — used after a
   * successful run's changes have been landed (or the user dismisses them),
   * since success defers automatic teardown. No-op when the run requested no
   * infra or no provider is configured. Idempotent.
   */
  async teardownInfra(runId: string): Promise<void> {
    const ctx = await this.buildContext(runId)
    if (!ctx) throw new Error(`Run ${runId} not found`)
    if (ctx.infraTemplate && this.infra.isConfigured()) {
      await this.infra.teardown(runId, ctx.instanceName, { remove: true })
    }
  }

  private async drive(runId: string, initial: RunSnapshot, ctx: RunCtx): Promise<void> {
    if (this.driving.has(runId)) return
    this.driving.add(runId)
    let snapshot = initial
    try {
      while (snapshot.status === 'running') {
        if (this.cancelled.has(runId)) {
          snapshot = await this.apply(runId, snapshot, { type: 'CANCEL' })
          break
        }
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

        // A setup stage provisions the run's write path first: an isolated
        // worktree (infra), a branch on the real checkout (local_branch), or
        // nothing (read_only).
        if (stage.type === 'setup' && !(await this.ensureSetup(runId, ctx))) {
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
                reason:
                  ctx.executionMode === 'local_branch'
                    ? 'Local branch preparation failed'
                    : 'Infrastructure provisioning failed'
              }
            },
            stage.id
          )
          continue
        }

        const outcome = await this.runStage(runId, snapshot, stage, ctx)
        snapshot = outcome.snapshot

        // A termination request during the stage (agents already cancelled) wins
        // over whatever the stage would otherwise have concluded.
        if (this.cancelled.has(runId)) {
          snapshot = await this.apply(runId, snapshot, { type: 'CANCEL' })
          break
        }

        if (outcome.passed) {
          const checkpoint = humanCheckpoint(stage)
          if (checkpoint) {
            snapshot = await this.apply(runId, snapshot, { type: 'GATE_AWAIT' })
            await this.emit(
              runId,
              {
                type: 'run.checkpoint_awaiting',
                actor: 'system',
                payload: {
                  runId,
                  stageId: stage.id,
                  checkpointId: checkpoint.id,
                  description: checkpoint.description
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
        } else if (stage.type === 'verification') {
          // Phase 6.3: a failed feature-verification stage records the issues and
          // routes the run back to the first stage — carrying them as feedback —
          // rather than failing outright. Bounded by maxVerificationCycles: once
          // the budget is spent we stop the auto-loop and escalate to a human
          // checkpoint instead of burning tokens in a verify→fix death cycle.
          const escalate = ctx.verificationCycles >= ctx.maxVerificationCycles
          ctx.verificationFeedback = outcome.reason
          await this.emit(
            runId,
            {
              type: 'run.verification_failed',
              actor: 'system',
              payload: {
                runId,
                stageId: stage.id,
                stageIndex: index,
                issues: outcome.reason,
                cycle: ctx.verificationCycles + 1,
                maxCycles: ctx.maxVerificationCycles,
                routedBack: !escalate
              }
            },
            stage.id
          )

          if (!escalate) {
            ctx.verificationCycles += 1
            snapshot = await this.apply(runId, snapshot, {
              type: 'REQUEST_CHANGES',
              targetIndex: 0
            })
            continue
          }

          // Budget spent — pause for human intervention (reuses the checkpoint machinery).
          snapshot = await this.apply(runId, snapshot, { type: 'GATE_AWAIT' })
          await this.emit(
            runId,
            {
              type: 'run.checkpoint_awaiting',
              actor: 'system',
              payload: {
                runId,
                stageId: stage.id,
                checkpointId: `verification-escalation:${stage.id}`,
                description:
                  `Verification failed ${ctx.maxVerificationCycles + 1} times. Human ` +
                  `intervention required: approve to accept as-is, reject to fail the run, ` +
                  `or request changes to loop back with a fresh budget.`
              }
            },
            stage.id
          )
          return // pause for a human
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
      this.cancelled.delete(runId)
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
      if (this.cancelled.has(runId))
        return { snapshot: current, passed: false, reason: 'cancelled' }
      const index = current.currentStageIndex
      const iteration = current.stages[index]!.iteration

      // Inside an isolated worktree, implementer agents may auto-apply file edits
      // (Bash/network still gated by allow-list + deny backstop); otherwise they
      // stay read-only until a setup stage isolates them.
      const mode: PermissionMode = ctx.isolated ? 'acceptEdits' : 'plan'
      const agentResults: AgentResult[] = []
      for (const persona of stage.personas) {
        if (this.cancelled.has(runId)) break // don't spawn further agents once terminating
        agentResults.push(
          await ctx.runAgent(
            persona,
            buildImplPrompt(ctx.spec, stage, persona, feedback, ctx.verificationFeedback),
            mode
          )
        )
      }
      if (this.cancelled.has(runId))
        return { snapshot: current, passed: false, reason: 'cancelled' }

      // Record each persona's artifact so a human can actually see what they're
      // approving at the stage's checkpoint (rendered as markdown in the run view).
      for (let i = 0; i < stage.personas.length; i++) {
        const persona = stage.personas[i]
        const result = agentResults[i]
        if (!persona || !result) continue
        await this.emit(
          runId,
          {
            type: 'run.stage_output',
            actor: 'agent',
            payload: {
              runId,
              stageId: stage.id,
              stageIndex: index,
              personaId: persona.id,
              personaName: persona.name,
              role: persona.role,
              iteration,
              artifact: result.resultText || result.text
            }
          },
          stage.id
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
