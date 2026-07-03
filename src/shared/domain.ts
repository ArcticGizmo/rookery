/**
 * Domain model for work items and approach definitions.
 *
 * zod schemas are the source of truth; TypeScript types are inferred from them
 * so validation and typing never drift. This module is imported by all three
 * processes, so it stays free of Electron/Node/DOM runtime deps (zod is pure JS).
 *
 * Persona/tooling detail is intentionally minimal here — Phase 3 (agent engine)
 * extends `AgentPersona` with MCP/tools/skills/effort mapping.
 */

import { z } from 'zod'

// --- Repos ------------------------------------------------------------------

/** A repository a work item touches. Local checkout is required (worktrees run
 * locally); the remote URL is optional context used later when landing changes. */
export const repoInputSchema = z.object({
  name: z.string().min(1, 'Repo name is required'),
  localPath: z.string().min(1, 'Local path is required'),
  // Accept empty string from form fields as "not provided".
  remoteUrl: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.url('Must be a valid URL').optional()
  )
})
export type RepoInput = z.infer<typeof repoInputSchema>

export const repoSchema = repoInputSchema.extend({
  id: z.string(),
  briefId: z.string()
})
export type Repo = z.infer<typeof repoSchema>

// --- Work items -------------------------------------------------------------

export const briefSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Title is required'),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Brief = z.infer<typeof briefSchema>

/** A single, immutable version of a work item's spec (content-addressed). */
export const specVersionSchema = z.object({
  id: z.string(),
  briefId: z.string(),
  version: z.number().int().positive(),
  contentHash: z.string(),
  content: z.string(),
  createdAt: z.string()
})
export type SpecVersion = z.infer<typeof specVersionSchema>

/** Aggregate returned to the UI: the item plus its repos and current spec. */
export interface BriefDetail {
  brief: Brief
  repos: Repo[]
  currentSpec: SpecVersion | null
}

/** One line of a spec diff between two versions. */
export interface SpecDiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  value: string
}

/** Structured line-level diff between two spec versions of a work item. */
export interface SpecDiff {
  briefId: string
  fromVersion: number
  toVersion: number
  lines: SpecDiffLine[]
}

export const createBriefInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  spec: z.string().default(''),
  repos: z.array(repoInputSchema).default([])
})
export type CreateBriefInput = z.infer<typeof createBriefInputSchema>

export const updateBriefInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  repos: z.array(repoInputSchema).default([])
})
export type UpdateBriefInput = z.infer<typeof updateBriefInputSchema>

// --- Approach building blocks ----------------------------------------------

/** Kinds of stage, mirroring the Example 1 flow in idea.md. */
export const stageTypeSchema = z.enum([
  'review',
  'plan',
  'setup',
  'implementation',
  'verification',
  'custom'
])
export type StageType = z.infer<typeof stageTypeSchema>

/**
 * An automated pass criterion evaluated by the engine (Phase 4.5 supplies the
 * pluggable evaluators). `manual` defers the decision to a human checkpoint.
 */
export const doneCriterionTypeSchema = z.enum([
  'reviewer_approves',
  'personas_agree',
  'tests_pass',
  'manual'
])
export type DoneCriterionType = z.infer<typeof doneCriterionTypeSchema>

export const doneCriterionSchema = z.object({
  id: z.string().min(1),
  type: doneCriterionTypeSchema,
  description: z.string().default('')
})
export type DoneCriterion = z.infer<typeof doneCriterionSchema>

/** A checkpoint halts a stage until satisfied. Human checkpoints require a person to act;
 * automated checkpoints are satisfied by their stage's pass criteria. */
export const checkpointKindSchema = z.enum(['human', 'automated'])
export type CheckpointKind = z.infer<typeof checkpointKindSchema>

export const checkpointSchema = z.object({
  id: z.string().min(1),
  kind: checkpointKindSchema,
  description: z.string().default('')
})
export type Checkpoint = z.infer<typeof checkpointSchema>

/** Reasoning effort levels supported by the Agent SDK. */
export const effortLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
export type EffortLevel = z.infer<typeof effortLevelSchema>

/**
 * An agent persona. `systemPrompt`, `model`, and `effort` shape the model; the
 * tool/MCP fields are BYO (bring-your-own) and map to Agent SDK options in
 * Phase 3. All tooling fields are optional and degrade gracefully when absent.
 */
export const agentPersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Persona name is required'),
  role: z.string().min(1, 'Persona role is required'),
  systemPrompt: z.string().default(''),
  model: z.string().nullish(),
  effort: effortLevelSchema.nullish(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  /** Passed through to the SDK's `mcpServers` option verbatim (BYO MCP). */
  mcpServers: z.record(z.string(), z.unknown()).optional()
})
export type AgentPersona = z.infer<typeof agentPersonaSchema>

/** A single stage in a approach. Order is the array index in `ApproachDef.stages`. */
export const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Stage name is required'),
  type: stageTypeSchema,
  personas: z.array(agentPersonaSchema).default([]),
  doneCriteria: z.array(doneCriterionSchema).default([]),
  checkpoints: z.array(checkpointSchema).default([])
})
export type Stage = z.infer<typeof stageSchema>

// --- Approach definitions ---------------------------------------------------

/** The editable body of a approach (what the builder produces and validates). */
export const approachDefBodySchema = z.object({
  name: z.string().min(1, 'Approach name is required'),
  description: z.string().default(''),
  stages: z.array(stageSchema).default([])
})
export type ApproachDefBody = z.infer<typeof approachDefBodySchema>

/** A persisted approach definition. `version` bumps on every saved edit. */
export const approachDefSchema = approachDefBodySchema.extend({
  id: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ApproachDef = z.infer<typeof approachDefSchema>

// --- Single-agent runs (Phase 3) -------------------------------------------

/** How the Agent SDK handles tool-permission decisions during a run. */
export const permissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto'
])
export type PermissionMode = z.infer<typeof permissionModeSchema>

/** Configuration for running one agent: a persona, a prompt, and a workdir. */
export const agentRunConfigSchema = z.object({
  persona: agentPersonaSchema,
  prompt: z.string().min(1, 'A prompt is required'),
  /** Working directory for the agent (typically a repo's local path). */
  cwd: z.string().nullish(),
  /**
   * Permission mode. Defaults to `plan` (read-only, no tool execution) — the
   * safe choice until Phase 5 runs agents inside isolated worktrees. Choose
   * `bypassPermissions` for autonomous editing/execution.
   */
  permissionMode: permissionModeSchema.default('plan')
})
export type AgentRunConfig = z.infer<typeof agentRunConfigSchema>

/** Whether Agent SDK credentials resolve, and where from. */
export interface CredentialStatus {
  available: boolean
  /** e.g. 'ANTHROPIC_API_KEY', 'claude-code-oauth', or null when none found. */
  source: string | null
}

// --- Runs / orchestration (Phase 4) ----------------------------------------

export const runStatusSchema = z.enum([
  'pending',
  'running',
  'awaiting_checkpoint',
  'passed',
  'failed',
  'cancelled'
])
export type RunStatus = z.infer<typeof runStatusSchema>

export const stageStatusSchema = z.enum(['pending', 'running', 'awaiting_checkpoint', 'passed', 'failed'])
export type StageStatus = z.infer<typeof stageStatusSchema>

/** A single execution of a approach over a work item. */
export interface Run {
  id: string
  briefId: string
  approachId: string
  approachVersion: number
  status: RunStatus
  currentStageIndex: number
  createdAt: string
  updatedAt: string
}

/** The execution record for one stage within a run (may re-run: `iteration`). */
export interface StageExecution {
  id: string
  runId: string
  stageId: string
  stageIndex: number
  status: StageStatus
  iteration: number
  startedAt: string | null
  finishedAt: string | null
}

/** Aggregate for the run view: the run, its stage executions, and the approach. */
export interface RunDetail {
  run: Run
  stages: StageExecution[]
  approach: ApproachDef
}

export const checkpointDecisionSchema = z.enum(['approve', 'reject', 'request_changes'])
export type CheckpointDecision = z.infer<typeof checkpointDecisionSchema>

/**
 * How stage agents get write access during a run:
 * - `read_only` — agents run in `plan` mode; no edits. Safe default.
 * - `local_branch` — the setup stage creates/checks out `workBranch` on the work
 *   item's own repo checkout and agents run with `acceptEdits`. Needs neither
 *   sprig nor Docker; changes stay in that repo's working tree for the user to
 *   review and land manually (network/push still blocked by the security backstop).
 * - `infra` — the setup stage provisions an isolated worktree + Docker infra via
 *   the configured provider (`infraTemplate`), and agents run with `acceptEdits`
 *   inside it.
 */
export const runExecutionModeSchema = z.enum(['read_only', 'local_branch', 'infra'])
export type RunExecutionMode = z.infer<typeof runExecutionModeSchema>

export const startRunInputSchema = z.object({
  briefId: z.string().min(1),
  approachId: z.string().min(1),
  /** Max implementer→reviewer iterations per stage before failing (default 3). */
  maxIterations: z.number().int().positive().max(20).default(3),
  /**
   * Feature-verification safeguard (Phase 6.3): how many times a failed
   * `verification` stage may automatically route the run back to the first stage
   * — carrying the recorded issues as feedback — before the engine stops looping
   * and escalates to a human checkpoint for intervention. Prevents a verify→fix death
   * cycle that silently burns tokens. Default 2.
   */
  maxVerificationCycles: z.number().int().positive().max(10).default(2),
  /**
   * Infra provider template (e.g. a sprig template) the run's setup stage
   * provisions from. Empty/omitted ⇒ no infra is provisioned and stage agents
   * run against the work item's own repo checkout. (Phase 5.4)
   */
  infraTemplate: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().optional()
  ),
  /** Tear the run's infra down when the run reaches a terminal state (default true). */
  teardownOnComplete: z.boolean().default(true),
  /**
   * Execution mode (see {@link runExecutionModeSchema}). Omitted ⇒ resolved by the
   * engine for backward compatibility: `infra` when an `infraTemplate` is set,
   * otherwise `read_only`.
   */
  executionMode: runExecutionModeSchema.optional(),
  /** Branch to create/checkout on the repo for `local_branch` mode (required then). */
  workBranch: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().optional())
})
export type StartRunInput = z.infer<typeof startRunInputSchema>

/** Resolve the effective execution mode, honoring the legacy infra-template default. */
export function resolveExecutionMode(input: {
  executionMode?: RunExecutionMode
  infraTemplate?: string | null
}): RunExecutionMode {
  return input.executionMode ?? (input.infraTemplate ? 'infra' : 'read_only')
}

export const checkpointActionInputSchema = z.object({
  runId: z.string().min(1),
  decision: checkpointDecisionSchema,
  /** Who acted (freeform, e.g. an email). */
  by: z.string().default('human'),
  note: z.string().default(''),
  /** For `request_changes`: stage index to route back to (default 0). */
  targetStageIndex: z.number().int().min(0).optional()
})
export type CheckpointActionInput = z.infer<typeof checkpointActionInputSchema>

// --- Landing changes (Phase 6.4) -------------------------------------------

/** How a repo's change reaches its main branch: open a PR, or merge directly. */
export const landingMethodSchema = z.enum(['pr', 'merge'])
export type LandingMethod = z.infer<typeof landingMethodSchema>

/** Land one impacted repo of a successful run (per-repo, human-directed). */
export const landRunInputSchema = z.object({
  runId: z.string().min(1),
  /** Repo alias (matches a provisioned worktree). */
  repo: z.string().min(1),
  method: landingMethodSchema,
  /** Who initiated the landing (freeform, e.g. an email). */
  by: z.string().default('human'),
  /** PR title (method `pr`); defaults to the work item title when omitted. */
  title: z.string().optional(),
  /** PR body (method `pr`). */
  body: z.string().optional()
})
export type LandRunInput = z.infer<typeof landRunInputSchema>
