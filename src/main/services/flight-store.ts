import { randomUUID } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import {
  type Flight,
  type FlightDetail,
  type FlightExecutionMode,
  type StageExecution,
  type ApproachDefBody,
  approachDefBodySchema
} from '@shared/domain'
import type { FlightSnapshot, StageSnapshot } from '@shared/flight-state-machine'
import type { Db } from '../db'
import { type FlightRow, type StageExecutionRow, flights, stageExecutions } from '../db/schema'

function toFlight(row: FlightRow): Flight {
  return {
    id: row.id,
    briefId: row.briefId,
    approachId: row.approachId,
    approachVersion: row.approachVersion,
    status: row.status as Flight['status'],
    currentStageIndex: row.currentStageIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toStage(row: StageExecutionRow): StageExecution {
  return {
    id: row.id,
    flightId: row.flightId,
    stageId: row.stageId,
    stageIndex: row.stageIndex,
    status: row.status as StageExecution['status'],
    iteration: row.iteration,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  }
}

export interface CreateFlightParams {
  briefId: string
  approachId: string
  approachVersion: number
  body: ApproachDefBody
  maxIterations: number
  /** Automatic verification→fix route-backs before escalation (Phase 6.3). */
  maxVerificationCycles: number
  /** Infra template the setup stage provisions from (null ⇒ no infra). */
  infraTemplate: string | null
  /** Tear infra down when the run finishes. */
  teardownOnComplete: boolean
  /** How stage agents get write access (null ⇒ derived from infraTemplate). */
  executionMode: FlightExecutionMode | null
  /** Branch for `local_branch` mode (null otherwise). */
  workBranch: string | null
}

/** Context the engine needs to drive a run. */
export interface FlightContext {
  briefId: string
  body: ApproachDefBody
  maxIterations: number
  maxVerificationCycles: number
  infraTemplate: string | null
  teardownOnComplete: boolean
  executionMode: FlightExecutionMode | null
  workBranch: string | null
}

/** Persistence for flights and their stage executions (Phase 4.1). */
export class FlightStore {
  constructor(private readonly db: Db) {}

  async create(params: CreateFlightParams): Promise<Flight> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.db.transaction(async (tx) => {
      await tx.insert(flights).values({
        id,
        briefId: params.briefId,
        approachId: params.approachId,
        approachVersion: params.approachVersion,
        approachBody: params.body,
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
          flightId: id,
          stageId: stage.id,
          stageIndex: index,
          status: 'pending',
          iteration: 0,
          startedAt: null,
          finishedAt: null
        })
      }
    })
    const row = (await this.db.select().from(flights).where(eq(flights.id, id)).limit(1))[0]!
    return toFlight(row)
  }

  async list(): Promise<Flight[]> {
    const rows = await this.db.select().from(flights).orderBy(desc(flights.updatedAt))
    return rows.map(toFlight)
  }

  async get(flightId: string): Promise<Flight | null> {
    const rows = await this.db.select().from(flights).where(eq(flights.id, flightId)).limit(1)
    return rows[0] ? toFlight(rows[0]) : null
  }

  async getContext(flightId: string): Promise<FlightContext | null> {
    const rows = await this.db.select().from(flights).where(eq(flights.id, flightId)).limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      briefId: row.briefId,
      body: approachDefBodySchema.parse(row.approachBody),
      maxIterations: row.maxIterations,
      maxVerificationCycles: row.maxVerificationCycles,
      infraTemplate: row.infraTemplate ?? null,
      teardownOnComplete: row.infraTeardown,
      executionMode: (row.executionMode as FlightExecutionMode | null) ?? null,
      workBranch: row.workBranch ?? null
    }
  }

  async getDetail(flightId: string): Promise<FlightDetail | null> {
    const rows = await this.db.select().from(flights).where(eq(flights.id, flightId)).limit(1)
    const row = rows[0]
    if (!row) return null
    const stageRows = await this.db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.flightId, flightId))
      .orderBy(asc(stageExecutions.stageIndex))
    const body = approachDefBodySchema.parse(row.approachBody)
    return {
      flight: toFlight(row),
      stages: stageRows.map(toStage),
      approach: {
        id: row.approachId,
        version: row.approachVersion,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...body
      }
    }
  }

  /** Rebuild the in-memory run snapshot from persisted rows (e.g. after a checkpoint). */
  async loadSnapshot(flightId: string): Promise<FlightSnapshot | null> {
    const rows = await this.db.select().from(flights).where(eq(flights.id, flightId)).limit(1)
    const row = rows[0]
    if (!row) return null
    const stageRows = await this.db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.flightId, flightId))
      .orderBy(asc(stageExecutions.stageIndex))
    const stages: StageSnapshot[] = stageRows.map((r) => ({
      stageId: r.stageId,
      index: r.stageIndex,
      status: r.status as StageSnapshot['status'],
      iteration: r.iteration
    }))
    return {
      status: row.status as FlightSnapshot['status'],
      currentStageIndex: row.currentStageIndex,
      stages
    }
  }

  /** Write a flight-state-machine snapshot back to the DB, maintaining timestamps. */
  async persistSnapshot(flightId: string, snapshot: FlightSnapshot, now: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(flights)
        .set({
          status: snapshot.status,
          currentStageIndex: snapshot.currentStageIndex,
          updatedAt: now
        })
        .where(eq(flights.id, flightId))

      const rows = await tx.select().from(stageExecutions).where(eq(stageExecutions.flightId, flightId))
      const byIndex = new Map(rows.map((r) => [r.stageIndex, r]))

      for (const stage of snapshot.stages) {
        const row = byIndex.get(stage.index)
        if (!row) continue
        let startedAt = row.startedAt
        let finishedAt = row.finishedAt
        if (stage.status === 'pending') {
          startedAt = null
          finishedAt = null
        } else if (stage.status === 'running' || stage.status === 'awaiting_checkpoint') {
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
