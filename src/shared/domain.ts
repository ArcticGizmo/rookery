/**
 * Domain model for work items and workflow definitions.
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
  workItemId: z.string()
})
export type Repo = z.infer<typeof repoSchema>

// --- Work items -------------------------------------------------------------

export const workItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Title is required'),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkItem = z.infer<typeof workItemSchema>

/** A single, immutable version of a work item's spec (content-addressed). */
export const specVersionSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  version: z.number().int().positive(),
  contentHash: z.string(),
  content: z.string(),
  createdAt: z.string()
})
export type SpecVersion = z.infer<typeof specVersionSchema>

/** Aggregate returned to the UI: the item plus its repos and current spec. */
export interface WorkItemDetail {
  workItem: WorkItem
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
  workItemId: string
  fromVersion: number
  toVersion: number
  lines: SpecDiffLine[]
}

export const createWorkItemInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  spec: z.string().default(''),
  repos: z.array(repoInputSchema).default([])
})
export type CreateWorkItemInput = z.infer<typeof createWorkItemInputSchema>

export const updateWorkItemInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  repos: z.array(repoInputSchema).default([])
})
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemInputSchema>

// --- Workflow building blocks ----------------------------------------------

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
 * pluggable evaluators). `manual` defers the decision to a human gate.
 */
export const passCriterionTypeSchema = z.enum([
  'reviewer_approves',
  'personas_agree',
  'tests_pass',
  'manual'
])
export type PassCriterionType = z.infer<typeof passCriterionTypeSchema>

export const passCriterionSchema = z.object({
  id: z.string().min(1),
  type: passCriterionTypeSchema,
  description: z.string().default('')
})
export type PassCriterion = z.infer<typeof passCriterionSchema>

/** A gate halts a stage until satisfied. Human gates require a person to act;
 * automated gates are satisfied by their stage's pass criteria. */
export const gateKindSchema = z.enum(['human', 'automated'])
export type GateKind = z.infer<typeof gateKindSchema>

export const gateSchema = z.object({
  id: z.string().min(1),
  kind: gateKindSchema,
  description: z.string().default('')
})
export type Gate = z.infer<typeof gateSchema>

/** An agent persona assigned to a stage. Kept minimal; Phase 3 extends it. */
export const agentPersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Persona name is required'),
  role: z.string().min(1, 'Persona role is required'),
  systemPrompt: z.string().default(''),
  model: z.string().nullish()
})
export type AgentPersona = z.infer<typeof agentPersonaSchema>

/** A single stage in a workflow. Order is the array index in `WorkflowDef.stages`. */
export const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Stage name is required'),
  type: stageTypeSchema,
  personas: z.array(agentPersonaSchema).default([]),
  passCriteria: z.array(passCriterionSchema).default([]),
  gates: z.array(gateSchema).default([])
})
export type Stage = z.infer<typeof stageSchema>

// --- Workflow definitions ---------------------------------------------------

/** The editable body of a workflow (what the builder produces and validates). */
export const workflowDefBodySchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().default(''),
  stages: z.array(stageSchema).default([])
})
export type WorkflowDefBody = z.infer<typeof workflowDefBodySchema>

/** A persisted workflow definition. `version` bumps on every saved edit. */
export const workflowDefSchema = workflowDefBodySchema.extend({
  id: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkflowDef = z.infer<typeof workflowDefSchema>
