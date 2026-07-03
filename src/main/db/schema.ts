import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Append-only event log. `id` is the monotonic sequence (autoincrement PK).
 * Rows are never updated or deleted — the log is the source of truth.
 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    runId: text('run_id'),
    stageId: text('stage_id'),
    payload: text('payload', { mode: 'json' }).notNull()
  },
  (table) => [
    index('idx_events_type').on(table.type),
    index('idx_events_run_id').on(table.runId),
    index('idx_events_ts').on(table.ts)
  ]
)

export type EventRow = typeof events.$inferSelect

/**
 * A unit of work: a versioned spec plus the repos it touches. The current spec
 * text lives in `spec_versions`; this row holds only stable metadata.
 */
export const briefs = sqliteTable('work_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export type BriefRow = typeof briefs.$inferSelect

/** Repos attached to a work item. Local checkout required; remote URL optional. */
export const repos = sqliteTable(
  'repos',
  {
    id: text('id').primaryKey(),
    briefId: text('work_item_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    localPath: text('local_path').notNull(),
    remoteUrl: text('remote_url')
  },
  (table) => [index('idx_repos_work_item').on(table.briefId)]
)

export type RepoRow = typeof repos.$inferSelect

/**
 * Append-only, content-addressed spec history. One row per distinct spec content
 * per work item; `version` is a per-item monotonic counter.
 */
export const specVersions = sqliteTable(
  'spec_versions',
  {
    id: text('id').primaryKey(),
    briefId: text('work_item_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    index('idx_spec_versions_work_item').on(table.briefId),
    uniqueIndex('idx_spec_versions_work_item_version').on(table.briefId, table.version)
  ]
)

export type SpecVersionRow = typeof specVersions.$inferSelect

/** Workflow definitions. The editable body (stages, personas, gates) is stored as
 * JSON; `version` bumps on every saved edit. */
export const workflowDefs = sqliteTable('workflow_defs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: integer('version').notNull(),
  body: text('body', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export type WorkflowDefRow = typeof workflowDefs.$inferSelect

/**
 * A run: one execution of a workflow over a work item. `workflowBody` snapshots
 * the workflow definition at start so a later edit doesn't mutate an in-flight
 * run. `status`/`currentStageIndex` mirror the run state machine.
 */
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    briefId: text('work_item_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    workflowBody: text('workflow_body', { mode: 'json' }).notNull(),
    status: text('status').notNull(),
    currentStageIndex: integer('current_stage_index').notNull(),
    maxIterations: integer('max_iterations').notNull(),
    /** Automatic verification→fix route-backs allowed before human escalation (Phase 6.3). */
    maxVerificationCycles: integer('max_verification_cycles').notNull().default(2),
    /** Infra provider template the setup stage provisions from (null ⇒ no infra). */
    infraTemplate: text('infra_template'),
    /** Whether to tear infra down when the run reaches a terminal state. */
    infraTeardown: integer('infra_teardown', { mode: 'boolean' }).notNull().default(true),
    /**
     * How stage agents get write access: 'read_only' (plan, no edits),
     * 'local_branch' (edit on a branch of the real checkout — no sprig/docker),
     * or 'infra' (isolated worktree via a provider). Null on legacy rows, which
     * are read as 'infra' when an infra template is set, else 'read_only'.
     */
    executionMode: text('execution_mode'),
    /** Branch created/checked out on the repo for 'local_branch' mode. */
    workBranch: text('work_branch'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [index('idx_runs_work_item').on(table.briefId)]
)

export type RunRow = typeof runs.$inferSelect

/** Per-stage execution record within a run. */
export const stageExecutions = sqliteTable(
  'stage_executions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stageId: text('stage_id').notNull(),
    stageIndex: integer('stage_index').notNull(),
    status: text('status').notNull(),
    iteration: integer('iteration').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at')
  },
  (table) => [
    index('idx_stage_exec_run').on(table.runId),
    uniqueIndex('idx_stage_exec_run_stage').on(table.runId, table.stageIndex)
  ]
)

export type StageExecutionRow = typeof stageExecutions.$inferSelect
