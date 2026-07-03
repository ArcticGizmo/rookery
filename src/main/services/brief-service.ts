import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import {
  type CreateBriefInput,
  type Repo,
  type RepoInput,
  type UpdateBriefInput,
  type Brief,
  type BriefDetail,
  createBriefInputSchema,
  updateBriefInputSchema
} from '@shared/domain'
import type { Db } from '../db'
import { type RepoRow, type BriefRow, repos, specVersions, briefs } from '../db/schema'
import type { AuditLog } from './audit-log'
import type { SpecService } from './spec-service'

function toBrief(row: BriefRow): Brief {
  return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function toRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    briefId: row.briefId,
    name: row.name,
    localPath: row.localPath,
    remoteUrl: row.remoteUrl ?? undefined
  }
}

function repoValues(briefId: string, input: RepoInput): RepoRow {
  return {
    id: randomUUID(),
    briefId,
    name: input.name,
    localPath: input.localPath,
    remoteUrl: input.remoteUrl ?? null
  }
}

/**
 * CRUD for work items and their attached repos (Phase 2.2). Spec content is
 * delegated to `SpecService`; every meaningful change is audited.
 */
export class BriefService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    private readonly specs: SpecService
  ) {}

  /** All work items, most recently updated first. */
  async list(): Promise<Brief[]> {
    const rows = await this.db.select().from(briefs).orderBy(desc(briefs.updatedAt))
    return rows.map(toBrief)
  }

  /** A work item with its repos and current spec, or null if not found. */
  async get(id: string): Promise<BriefDetail | null> {
    const itemRows = await this.db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
    const item = itemRows[0]
    if (!item) return null
    const repoRows = await this.db.select().from(repos).where(eq(repos.briefId, id))
    const currentSpec = await this.specs.getLatest(id)
    return { brief: toBrief(item), repos: repoRows.map(toRepo), currentSpec }
  }

  async create(input: CreateBriefInput): Promise<BriefDetail> {
    const parsed = createBriefInputSchema.parse(input)
    const id = randomUUID()
    const now = new Date().toISOString()

    await this.db.transaction(async (tx) => {
      await tx.insert(briefs).values({ id, title: parsed.title, createdAt: now, updatedAt: now })
      for (const repo of parsed.repos) {
        await tx.insert(repos).values(repoValues(id, repo))
      }
    })

    await this.audit.append({
      type: 'brief.created',
      actor: 'human',
      flightId: null,
      stageId: null,
      payload: { briefId: id, title: parsed.title }
    })
    // Establish the first spec version (audited by the spec service).
    await this.specs.saveSpec(id, parsed.spec)

    const detail = await this.get(id)
    if (!detail) throw new Error('Work item vanished immediately after creation')
    return detail
  }

  async update(id: string, input: UpdateBriefInput): Promise<BriefDetail> {
    const parsed = updateBriefInputSchema.parse(input)
    const existing = await this.db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
    if (!existing[0]) throw new Error(`Work item ${id} not found`)
    const now = new Date().toISOString()

    await this.db.transaction(async (tx) => {
      await tx
        .update(briefs)
        .set({ title: parsed.title, updatedAt: now })
        .where(eq(briefs.id, id))
      // Repos are small and fully owned by the item — replace wholesale.
      await tx.delete(repos).where(eq(repos.briefId, id))
      for (const repo of parsed.repos) {
        await tx.insert(repos).values(repoValues(id, repo))
      }
    })

    await this.audit.append({
      type: 'brief.updated',
      actor: 'human',
      flightId: null,
      stageId: null,
      payload: { briefId: id, title: parsed.title }
    })

    const detail = await this.get(id)
    if (!detail) throw new Error('Work item vanished immediately after update')
    return detail
  }

  async delete(id: string): Promise<void> {
    const existing = await this.db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
    if (!existing[0]) throw new Error(`Work item ${id} not found`)

    await this.db.transaction(async (tx) => {
      await tx.delete(specVersions).where(eq(specVersions.briefId, id))
      await tx.delete(repos).where(eq(repos.briefId, id))
      await tx.delete(briefs).where(eq(briefs.id, id))
    })

    await this.audit.append({
      type: 'brief.deleted',
      actor: 'human',
      flightId: null,
      stageId: null,
      payload: { briefId: id }
    })
  }
}
