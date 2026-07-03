/**
 * Turning a drafting agent's reply into a real approach (Phase J4.2). The agent is
 * asked for a compact JSON proposal; this module extracts and validates it into an
 * ApproachDefBody (assigning ids). Pure and lenient — models wrap JSON in prose or
 * fences and occasionally use a slightly-off enum — so parsing lives here, apart
 * from the agent plumbing, and is unit-tested without spawning an agent.
 */

import { z } from 'zod'
import {
  type ApproachDefBody,
  type DoneCriterionType,
  type StageType,
  doneCriterionTypeSchema,
  stageTypeSchema
} from './domain'

export type ApproachDraftResult =
  | { ok: true; body: ApproachDefBody }
  | { ok: false; message: string }

/** The compact shape we ask the drafting agent to emit (lenient on purpose). */
const draftStageSchema = z.object({
  name: z.string().default('Step'),
  type: z.string().default('custom'),
  roles: z
    .array(
      z.object({
        name: z.string().default('Agent'),
        role: z.string().default(''),
        systemPrompt: z.string().default('')
      })
    )
    .default([]),
  done: z.array(z.string()).default([]),
  hold: z.boolean().default(false)
})

const draftSchema = z.object({
  name: z.string().default(''),
  stages: z.array(draftStageSchema).default([])
})

/** Pull the JSON object out of a model reply (handles ```json fences and prose). */
function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return candidate.slice(start, end + 1)
}

function coerceStageType(value: string): StageType {
  const parsed = stageTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'custom'
}

function isDoneType(value: string): value is DoneCriterionType {
  return doneCriterionTypeSchema.safeParse(value).success
}

/**
 * Parse a drafting agent's reply into an approach for `briefId`. `uid` is
 * injectable for deterministic tests; it defaults to `crypto.randomUUID`.
 */
export function parseApproachDraft(
  text: string,
  briefId: string,
  uid: () => string = () => crypto.randomUUID()
): ApproachDraftResult {
  const json = extractJson(text)
  if (!json) return { ok: false, message: 'The agent did not return a recognizable approach.' }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, message: 'The agent returned malformed JSON.' }
  }

  const parsed = draftSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, message: "The agent's proposal did not match the expected shape." }
  }
  if (parsed.data.stages.length === 0) {
    return { ok: false, message: 'The agent proposed no steps — try again or start from a template.' }
  }

  const body: ApproachDefBody = {
    name: parsed.data.name.trim() || 'Drafted approach',
    description: '',
    briefId,
    stages: parsed.data.stages.map((stage) => ({
      id: uid(),
      name: stage.name.trim() || 'Step',
      type: coerceStageType(stage.type),
      personas: stage.roles.map((r) => ({
        id: uid(),
        name: r.name.trim() || 'Agent',
        role: r.role.trim() || r.name.trim() || 'Agent',
        systemPrompt: r.systemPrompt,
        model: ''
      })),
      doneCriteria: stage.done.filter(isDoneType).map((type) => ({
        id: uid(),
        type,
        description: ''
      })),
      checkpoints: stage.hold ? [{ id: uid(), kind: 'human' as const, description: '' }] : []
    }))
  }
  return { ok: true, body }
}
