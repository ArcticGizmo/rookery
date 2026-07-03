import { randomUUID } from 'node:crypto'
import { diffLines } from 'diff'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { SpecDiff, SpecDiffLine, SpecVersion } from '@shared/domain'
import type { Db } from '../db'
import { type SpecVersionRow, specVersions } from '../db/schema'
import type { AuditLog } from './audit-log'
import { hashContent } from './hash'

function toSpecVersion(row: SpecVersionRow): SpecVersion {
  return {
    id: row.id,
    briefId: row.briefId,
    version: row.version,
    contentHash: row.contentHash,
    content: row.content,
    createdAt: row.createdAt
  }
}

/** Split a diff hunk's text into individual lines, dropping the empty trailing
 * element produced by a final newline. */
function toLines(kind: SpecDiffLine['kind'], value: string): SpecDiffLine[] {
  const segments = value.split('\n')
  if (segments.length > 0 && segments[segments.length - 1] === '') segments.pop()
  return segments.map((segment) => ({ kind, value: segment }))
}

/**
 * Append-only, content-addressed spec versioning (Phase 2.4). A new version is
 * cut only when the content actually changes; identical saves are no-ops.
 */
export class SpecService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog
  ) {}

  /** The latest spec version for a brief, or null if none exists yet. */
  async getLatest(briefId: string): Promise<SpecVersion | null> {
    const rows = await this.db
      .select()
      .from(specVersions)
      .where(eq(specVersions.briefId, briefId))
      .orderBy(desc(specVersions.version))
      .limit(1)
    return rows[0] ? toSpecVersion(rows[0]) : null
  }

  /** Full version history for a brief, oldest first. */
  async history(briefId: string): Promise<SpecVersion[]> {
    const rows = await this.db
      .select()
      .from(specVersions)
      .where(eq(specVersions.briefId, briefId))
      .orderBy(asc(specVersions.version))
    return rows.map(toSpecVersion)
  }

  async getVersion(briefId: string, version: number): Promise<SpecVersion | null> {
    const rows = await this.db
      .select()
      .from(specVersions)
      .where(and(eq(specVersions.briefId, briefId), eq(specVersions.version, version)))
      .limit(1)
    return rows[0] ? toSpecVersion(rows[0]) : null
  }

  /**
   * Persist a spec. Returns the existing latest version unchanged when the
   * content hasn't changed; otherwise appends a new version and audits it.
   */
  async saveSpec(briefId: string, content: string): Promise<SpecVersion> {
    const latest = await this.getLatest(briefId)
    const contentHash = hashContent(content)
    if (latest && latest.contentHash === contentHash) return latest

    const version = latest ? latest.version + 1 : 1
    const rows = await this.db
      .insert(specVersions)
      .values({
        id: randomUUID(),
        briefId,
        version,
        contentHash,
        content,
        createdAt: new Date().toISOString()
      })
      .returning()
    const stored = toSpecVersion(rows[0]!)
    await this.audit.append({
      type: 'spec.version_created',
      actor: 'human',
      flightId: null,
      stageId: null,
      payload: { briefId, version, contentHash }
    })
    return stored
  }

  /** Line-level diff between two versions of a brief's spec. */
  async diff(briefId: string, fromVersion: number, toVersion: number): Promise<SpecDiff> {
    const [from, to] = await Promise.all([
      this.getVersion(briefId, fromVersion),
      this.getVersion(briefId, toVersion)
    ])
    if (!from) throw new Error(`Spec version ${fromVersion} not found for brief ${briefId}`)
    if (!to) throw new Error(`Spec version ${toVersion} not found for brief ${briefId}`)

    const lines = diffLines(from.content, to.content).flatMap((part) =>
      toLines(part.added ? 'added' : part.removed ? 'removed' : 'unchanged', part.value)
    )
    return { briefId, fromVersion, toVersion, lines }
  }
}
