import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import {
  type CreateWorkItemInput,
  type Repo,
  type RepoInput,
  type UpdateWorkItemInput,
  type WorkItem,
  type WorkItemDetail,
  createWorkItemInputSchema,
  updateWorkItemInputSchema
} from '@shared/domain'
import type { Db } from '../db'
import { type RepoRow, type WorkItemRow, repos, specVersions, workItems } from '../db/schema'
import type { AuditLog } from './audit-log'
import type { SpecService } from './spec-service'

function toWorkItem(row: WorkItemRow): WorkItem {
  return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function toRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    workItemId: row.workItemId,
    name: row.name,
    localPath: row.localPath,
    remoteUrl: row.remoteUrl ?? undefined
  }
}

function repoValues(workItemId: string, input: RepoInput): RepoRow {
  return {
    id: randomUUID(),
    workItemId,
    name: input.name,
    localPath: input.localPath,
    remoteUrl: input.remoteUrl ?? null
  }
}

/**
 * CRUD for work items and their attached repos (Phase 2.2). Spec content is
 * delegated to `SpecService`; every meaningful change is audited.
 */
export class WorkItemService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    private readonly specs: SpecService
  ) {}

  /** All work items, most recently updated first. */
  async list(): Promise<WorkItem[]> {
    const rows = await this.db.select().from(workItems).orderBy(desc(workItems.updatedAt))
    return rows.map(toWorkItem)
  }

  /** A work item with its repos and current spec, or null if not found. */
  async get(id: string): Promise<WorkItemDetail | null> {
    const itemRows = await this.db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
    const item = itemRows[0]
    if (!item) return null
    const repoRows = await this.db.select().from(repos).where(eq(repos.workItemId, id))
    const currentSpec = await this.specs.getLatest(id)
    return { workItem: toWorkItem(item), repos: repoRows.map(toRepo), currentSpec }
  }

  async create(input: CreateWorkItemInput): Promise<WorkItemDetail> {
    const parsed = createWorkItemInputSchema.parse(input)
    const id = randomUUID()
    const now = new Date().toISOString()

    await this.db.transaction(async (tx) => {
      await tx.insert(workItems).values({ id, title: parsed.title, createdAt: now, updatedAt: now })
      for (const repo of parsed.repos) {
        await tx.insert(repos).values(repoValues(id, repo))
      }
    })

    await this.audit.append({
      type: 'workitem.created',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workItemId: id, title: parsed.title }
    })
    // Establish the first spec version (audited by the spec service).
    await this.specs.saveSpec(id, parsed.spec)

    const detail = await this.get(id)
    if (!detail) throw new Error('Work item vanished immediately after creation')
    return detail
  }

  async update(id: string, input: UpdateWorkItemInput): Promise<WorkItemDetail> {
    const parsed = updateWorkItemInputSchema.parse(input)
    const existing = await this.db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
    if (!existing[0]) throw new Error(`Work item ${id} not found`)
    const now = new Date().toISOString()

    await this.db.transaction(async (tx) => {
      await tx
        .update(workItems)
        .set({ title: parsed.title, updatedAt: now })
        .where(eq(workItems.id, id))
      // Repos are small and fully owned by the item — replace wholesale.
      await tx.delete(repos).where(eq(repos.workItemId, id))
      for (const repo of parsed.repos) {
        await tx.insert(repos).values(repoValues(id, repo))
      }
    })

    await this.audit.append({
      type: 'workitem.updated',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workItemId: id, title: parsed.title }
    })

    const detail = await this.get(id)
    if (!detail) throw new Error('Work item vanished immediately after update')
    return detail
  }

  async delete(id: string): Promise<void> {
    const existing = await this.db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
    if (!existing[0]) throw new Error(`Work item ${id} not found`)

    await this.db.transaction(async (tx) => {
      await tx.delete(specVersions).where(eq(specVersions.workItemId, id))
      await tx.delete(repos).where(eq(repos.workItemId, id))
      await tx.delete(workItems).where(eq(workItems.id, id))
    })

    await this.audit.append({
      type: 'workitem.deleted',
      actor: 'human',
      runId: null,
      stageId: null,
      payload: { workItemId: id }
    })
  }
}
