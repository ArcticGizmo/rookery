import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { type ApproachDef, type ApproachDefBody, approachDefBodySchema } from '@shared/domain'
import type { Db } from '../db'
import { type ApproachDefRow, approachDefs } from '../db/schema'
import type { AuditLog } from './audit-log'

function toApproachDef(row: ApproachDefRow): ApproachDef {
  // The JSON body is the source of truth for the editable fields.
  const body = approachDefBodySchema.parse(row.body)
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...body
  }
}

/**
 * CRUD for approach definitions (Phase 2.3). The editable body is stored as a
 * versioned JSON blob; `version` bumps on every saved edit and each
 * create/edit/delete is audited. Semantic validation lives in
 * `@shared/approach-validation` and is applied by callers before a run starts —
 * drafts may still be saved so authoring can happen incrementally.
 */
export class ApproachService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog
  ) {}

  async list(): Promise<ApproachDef[]> {
    const rows = await this.db.select().from(approachDefs).orderBy(desc(approachDefs.updatedAt))
    return rows.map(toApproachDef)
  }

  async get(id: string): Promise<ApproachDef | null> {
    const rows = await this.db.select().from(approachDefs).where(eq(approachDefs.id, id)).limit(1)
    return rows[0] ? toApproachDef(rows[0]) : null
  }

  async create(input: ApproachDefBody): Promise<ApproachDef> {
    const body = approachDefBodySchema.parse(input)
    const id = randomUUID()
    const now = new Date().toISOString()
    const rows = await this.db
      .insert(approachDefs)
      .values({ id, name: body.name, version: 1, body, createdAt: now, updatedAt: now })
      .returning()
    const stored = toApproachDef(rows[0]!)
    await this.audit.append({
      type: 'approach.created',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { approachId: id, name: body.name, version: 1 }
    })
    return stored
  }

  async update(id: string, input: ApproachDefBody): Promise<ApproachDef> {
    const existing = await this.get(id)
    if (!existing) throw new Error(`Approach ${id} not found`)
    const body = approachDefBodySchema.parse(input)
    const version = existing.version + 1
    const now = new Date().toISOString()
    const rows = await this.db
      .update(approachDefs)
      .set({ name: body.name, version, body, updatedAt: now })
      .where(eq(approachDefs.id, id))
      .returning()
    const stored = toApproachDef(rows[0]!)
    await this.audit.append({
      type: 'approach.updated',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { approachId: id, name: body.name, version }
    })
    return stored
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) throw new Error(`Approach ${id} not found`)
    await this.db.delete(approachDefs).where(eq(approachDefs.id, id))
    await this.audit.append({
      type: 'approach.deleted',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { approachId: id }
    })
  }
}
