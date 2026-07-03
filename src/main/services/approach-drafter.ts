import { type ApproachDraftResult, parseApproachDraft } from '@shared/approach-draft'
import type { AgentService } from './agent-service'
import type { BriefService } from './brief-service'

/**
 * Drafts an approach from a brief by asking an agent for a compact JSON proposal
 * (Phase J4.2). The agent runs read-only (`plan`) with no tools — it only reasons
 * over the brief text — and its activity streams to the audit log like any agent.
 * Parsing/validation of the reply lives in `@shared/approach-draft`.
 */

const DRAFTER_SYSTEM_PROMPT = `You are a delivery lead planning how a coding task should be tackled by a mix of AI agents and human checkpoints.

Given a brief, propose an approach as an ordered list of steps. Reply with ONLY a JSON object (optionally inside a \`\`\`json fence), no prose outside it, of this exact shape:

{
  "name": string,
  "stages": [
    {
      "name": string,
      "type": "review" | "plan" | "setup" | "implementation" | "verification" | "custom",
      "roles": [ { "name": string, "role": string, "systemPrompt": string } ],
      "done": ["manual" | "reviewer_approves" | "personas_agree" | "tests_pass"],
      "hold": boolean
    }
  ]
}

Guidance:
- A typical flow is review -> plan -> setup -> implement -> verify. Adapt it to the brief.
- "hold": true means the flight pauses for a human decision after that step. Hold after review, after plan, and before the change lands.
- Steps before any code exists (review, plan) must use "done": ["manual"] — automated checks can only judge code that exists yet.
- Use "reviewer_approves" for implementation and "tests_pass" for verification.
- Give every role a concrete, specific systemPrompt describing its job for THIS brief.
- Keep it to 3-6 steps.`

export async function draftApproachForBrief(
  agent: AgentService,
  briefs: BriefService,
  briefId: string
): Promise<ApproachDraftResult> {
  const detail = await briefs.get(briefId)
  if (!detail) return { ok: false, message: 'Brief not found.' }
  const spec = detail.currentSpec?.content ?? ''
  if (!spec.trim()) {
    return { ok: false, message: 'Write the brief first — there is nothing to draft from.' }
  }

  let result
  try {
    result = await agent.run({
      persona: {
        id: 'approach-drafter',
        name: 'Approach drafter',
        role: 'Planner',
        systemPrompt: DRAFTER_SYSTEM_PROMPT
      },
      prompt: `Brief: ${detail.brief.title}\n\n${spec}`,
      permissionMode: 'plan'
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }

  if (result.isError) {
    return { ok: false, message: result.resultText || 'The drafting agent failed.' }
  }
  return parseApproachDraft(result.resultText, briefId)
}
