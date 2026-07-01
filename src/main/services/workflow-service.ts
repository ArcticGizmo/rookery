import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { type WorkflowDef, type WorkflowDefBody, workflowDefBodySchema } from '@shared/domain'
import type { Db } from '../db'
import { type WorkflowDefRow, workflowDefs } from '../db/schema'
import type { AuditLog } from './audit-log'

function toWorkflowDef(row: WorkflowDefRow): WorkflowDef {
  // The JSON body is the source of truth for the editable fields.
  const body = workflowDefBodySchema.parse(row.body)
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...body
  }
}

/**
 * CRUD for workflow definitions (Phase 2.3). The editable body is stored as a
 * versioned JSON blob; `version` bumps on every saved edit and each
 * create/edit/delete is audited. Semantic validation lives in
 * `@shared/workflow-validation` and is applied by callers before a run starts —
 * drafts may still be saved so authoring can happen incrementally.
 */
export class WorkflowService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog
  ) {}

  async list(): Promise<WorkflowDef[]> {
    const rows = await this.db.select().from(workflowDefs).orderBy(desc(workflowDefs.updatedAt))
    return rows.map(toWorkflowDef)
  }

  async get(id: string): Promise<WorkflowDef | null> {
    const rows = await this.db.select().from(workflowDefs).where(eq(workflowDefs.id, id)).limit(1)
    return rows[0] ? toWorkflowDef(rows[0]) : null
  }

  async create(input: WorkflowDefBody): Promise<WorkflowDef> {
    const body = workflowDefBodySchema.parse(input)
    const id = randomUUID()
    const now = new Date().toISOString()
    const rows = await this.db
      .insert(workflowDefs)
      .values({ id, name: body.name, version: 1, body, createdAt: now, updatedAt: now })
      .returning()
    const stored = toWorkflowDef(rows[0]!)
    await this.audit.append({
      type: 'workflow.created',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workflowId: id, name: body.name, version: 1 }
    })
    return stored
  }

  async update(id: string, input: WorkflowDefBody): Promise<WorkflowDef> {
    const existing = await this.get(id)
    if (!existing) throw new Error(`Workflow ${id} not found`)
    const body = workflowDefBodySchema.parse(input)
    const version = existing.version + 1
    const now = new Date().toISOString()
    const rows = await this.db
      .update(workflowDefs)
      .set({ name: body.name, version, body, updatedAt: now })
      .where(eq(workflowDefs.id, id))
      .returning()
    const stored = toWorkflowDef(rows[0]!)
    await this.audit.append({
      type: 'workflow.updated',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workflowId: id, name: body.name, version }
    })
    return stored
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) throw new Error(`Workflow ${id} not found`)
    await this.db.delete(workflowDefs).where(eq(workflowDefs.id, id))
    await this.audit.append({
      type: 'workflow.deleted',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workflowId: id }
    })
  }
}
