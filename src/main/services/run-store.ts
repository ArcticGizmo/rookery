import { randomUUID } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import {
  type Run,
  type RunDetail,
  type RunExecutionMode,
  type StageExecution,
  type WorkflowDefBody,
  workflowDefBodySchema
} from '@shared/domain'
import type { RunSnapshot, StageSnapshot } from '@shared/run-state-machine'
import type { Db } from '../db'
import { type RunRow, type StageExecutionRow, runs, stageExecutions } from '../db/schema'

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    briefId: row.briefId,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    status: row.status as Run['status'],
    currentStageIndex: row.currentStageIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toStage(row: StageExecutionRow): StageExecution {
  return {
    id: row.id,
    runId: row.runId,
    stageId: row.stageId,
    stageIndex: row.stageIndex,
    status: row.status as StageExecution['status'],
    iteration: row.iteration,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  }
}

export interface CreateRunParams {
  briefId: string
  workflowId: string
  workflowVersion: number
  body: WorkflowDefBody
  maxIterations: number
  /** Automatic verification→fix route-backs before escalation (Phase 6.3). */
  maxVerificationCycles: number
  /** Infra template the setup stage provisions from (null ⇒ no infra). */
  infraTemplate: string | null
  /** Tear infra down when the run finishes. */
  teardownOnComplete: boolean
  /** How stage agents get write access (null ⇒ derived from infraTemplate). */
  executionMode: RunExecutionMode | null
  /** Branch for `local_branch` mode (null otherwise). */
  workBranch: string | null
}

/** Context the engine needs to drive a run. */
export interface RunContext {
  briefId: string
  body: WorkflowDefBody
  maxIterations: number
  maxVerificationCycles: number
  infraTemplate: string | null
  teardownOnComplete: boolean
  executionMode: RunExecutionMode | null
  workBranch: string | null
}

/** Persistence for runs and their stage executions (Phase 4.1). */
export class RunStore {
  constructor(private readonly db: Db) {}

  async create(params: CreateRunParams): Promise<Run> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.db.transaction(async (tx) => {
      await tx.insert(runs).values({
        id,
        briefId: params.briefId,
        workflowId: params.workflowId,
        workflowVersion: params.workflowVersion,
        workflowBody: params.body,
        status: 'pending',
        currentStageIndex: 0,
        maxIterations: params.maxIterations,
        maxVerificationCycles: params.maxVerificationCycles,
        infraTemplate: params.infraTemplate,
        infraTeardown: params.teardownOnComplete,
        executionMode: params.executionMode,
        workBranch: params.workBranch,
        createdAt: now,
        updatedAt: now
      })
      for (const [index, stage] of params.body.stages.entries()) {
        await tx.insert(stageExecutions).values({
          id: randomUUID(),
          runId: id,
          stageId: stage.id,
          stageIndex: index,
          status: 'pending',
          iteration: 0,
          startedAt: null,
          finishedAt: null
        })
      }
    })
    const row = (await this.db.select().from(runs).where(eq(runs.id, id)).limit(1))[0]!
    return toRun(row)
  }

  async list(): Promise<Run[]> {
    const rows = await this.db.select().from(runs).orderBy(desc(runs.updatedAt))
    return rows.map(toRun)
  }

  async get(runId: string): Promise<Run | null> {
    const rows = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1)
    return rows[0] ? toRun(rows[0]) : null
  }

  async getContext(runId: string): Promise<RunContext | null> {
    const rows = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      briefId: row.briefId,
      body: workflowDefBodySchema.parse(row.workflowBody),
      maxIterations: row.maxIterations,
      maxVerificationCycles: row.maxVerificationCycles,
      infraTemplate: row.infraTemplate ?? null,
      teardownOnComplete: row.infraTeardown,
      executionMode: (row.executionMode as RunExecutionMode | null) ?? null,
      workBranch: row.workBranch ?? null
    }
  }

  async getDetail(runId: string): Promise<RunDetail | null> {
    const rows = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1)
    const row = rows[0]
    if (!row) return null
    const stageRows = await this.db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.runId, runId))
      .orderBy(asc(stageExecutions.stageIndex))
    const body = workflowDefBodySchema.parse(row.workflowBody)
    return {
      run: toRun(row),
      stages: stageRows.map(toStage),
      workflow: {
        id: row.workflowId,
        version: row.workflowVersion,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...body
      }
    }
  }

  /** Rebuild the in-memory run snapshot from persisted rows (e.g. after a gate). */
  async loadSnapshot(runId: string): Promise<RunSnapshot | null> {
    const rows = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1)
    const row = rows[0]
    if (!row) return null
    const stageRows = await this.db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.runId, runId))
      .orderBy(asc(stageExecutions.stageIndex))
    const stages: StageSnapshot[] = stageRows.map((r) => ({
      stageId: r.stageId,
      index: r.stageIndex,
      status: r.status as StageSnapshot['status'],
      iteration: r.iteration
    }))
    return {
      status: row.status as RunSnapshot['status'],
      currentStageIndex: row.currentStageIndex,
      stages
    }
  }

  /** Write a run-state-machine snapshot back to the DB, maintaining timestamps. */
  async persistSnapshot(runId: string, snapshot: RunSnapshot, now: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(runs)
        .set({
          status: snapshot.status,
          currentStageIndex: snapshot.currentStageIndex,
          updatedAt: now
        })
        .where(eq(runs.id, runId))

      const rows = await tx.select().from(stageExecutions).where(eq(stageExecutions.runId, runId))
      const byIndex = new Map(rows.map((r) => [r.stageIndex, r]))

      for (const stage of snapshot.stages) {
        const row = byIndex.get(stage.index)
        if (!row) continue
        let startedAt = row.startedAt
        let finishedAt = row.finishedAt
        if (stage.status === 'pending') {
          startedAt = null
          finishedAt = null
        } else if (stage.status === 'running' || stage.status === 'awaiting_gate') {
          startedAt = startedAt ?? now
          finishedAt = null
        } else {
          // passed | failed
          startedAt = startedAt ?? now
          finishedAt = finishedAt ?? now
        }
        await tx
          .update(stageExecutions)
          .set({ status: stage.status, iteration: stage.iteration, startedAt, finishedAt })
          .where(eq(stageExecutions.id, row.id))
      }
    })
  }
}
