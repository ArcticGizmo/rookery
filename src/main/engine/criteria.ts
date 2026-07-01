import type { AgentPersona, PassCriterion, PermissionMode, Stage } from '@shared/domain'
import type { AgentResult } from '../agent/types'

export interface CriterionContext {
  /** The work item's current spec text. */
  spec: string
  cwd?: string | null
  /** Outputs produced by this stage's agents in the current iteration. */
  agentResults: AgentResult[]
  /** Run a checker/reviewer agent to completion (injected → testable). */
  runAgent: (
    persona: AgentPersona,
    prompt: string,
    permissionMode: PermissionMode
  ) => Promise<AgentResult>
}

export interface CriterionOutcome {
  criterion: PassCriterion
  passed: boolean
  detail: string
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return (line ?? '').slice(0, 200)
}

/** Decide pass/fail from a checker agent's verdict. Conservative: unclear = fail. */
function verdict(
  result: AgentResult,
  positive: string,
  negative: string
): { passed: boolean; detail: string } {
  const text = result.resultText || result.text
  if (result.isError) return { passed: false, detail: `Checker errored: ${firstLine(text)}` }
  const upper = text.toUpperCase()
  if (upper.includes(negative)) return { passed: false, detail: firstLine(text) }
  if (upper.includes(positive)) return { passed: true, detail: firstLine(text) }
  return { passed: false, detail: `Unclear verdict: ${firstLine(text)}` }
}

function summarize(results: AgentResult[]): string {
  if (results.length === 0) return '(no agent output was produced)'
  return results
    .map(
      (r, i) => `--- Output ${i + 1}${r.isError ? ' (errored)' : ''} ---\n${r.resultText || r.text}`
    )
    .join('\n\n')
}

const reviewerPersona: AgentPersona = {
  id: 'criterion-reviewer',
  name: 'Criterion reviewer',
  role: 'Reviewer',
  systemPrompt: 'You are a meticulous senior reviewer. Judge strictly against the spec.',
  allowedTools: ['Read', 'Grep', 'Glob']
}

const testerPersona: AgentPersona = {
  id: 'criterion-tester',
  name: 'Test runner',
  role: 'Tester',
  systemPrompt: 'You run the project test suite and report the outcome precisely.',
  allowedTools: ['Bash', 'Read', 'Grep', 'Glob']
}

type Evaluator = (criterion: PassCriterion, ctx: CriterionContext) => Promise<CriterionOutcome>

const EVALUATORS: Record<PassCriterion['type'], Evaluator> = {
  manual: async (criterion) => ({
    criterion,
    passed: true,
    detail: 'Deferred to a human gate.'
  }),

  reviewer_approves: async (criterion, ctx) => {
    const prompt =
      `Review the work below against the spec.\n\nSPEC:\n${ctx.spec}\n\n` +
      `WORK:\n${summarize(ctx.agentResults)}\n\n` +
      `Reply with APPROVE on the first line if it fully satisfies the spec with no required ` +
      `changes, otherwise REJECT followed by the specific changes needed.`
    const result = await ctx.runAgent(reviewerPersona, prompt, 'plan')
    return { criterion, ...verdict(result, 'APPROVE', 'REJECT') }
  },

  personas_agree: async (criterion, ctx) => {
    const prompt =
      `Several reviewer personas produced the outputs below.\n\n${summarize(ctx.agentResults)}\n\n` +
      `Do they AGREE that no further changes are needed? Reply AGREE on the first line if so, ` +
      `otherwise DISAGREE followed by what remains.`
    const result = await ctx.runAgent(reviewerPersona, prompt, 'plan')
    return { criterion, ...verdict(result, 'AGREE', 'DISAGREE') }
  },

  tests_pass: async (criterion, ctx) => {
    const prompt =
      `Run the project's automated test suite in the working directory and report the outcome. ` +
      `Reply PASS on the first line if every test passes, otherwise FAIL followed by which failed.`
    const result = await ctx.runAgent(testerPersona, prompt, 'bypassPermissions')
    return { criterion, ...verdict(result, 'PASS', 'FAIL') }
  }
}

/** Evaluate all of a stage's pass criteria (Phase 4.5). Empty ⇒ vacuously passes. */
export async function evaluateCriteria(
  stage: Stage,
  ctx: CriterionContext
): Promise<CriterionOutcome[]> {
  const outcomes: CriterionOutcome[] = []
  for (const criterion of stage.passCriteria) {
    outcomes.push(await EVALUATORS[criterion.type](criterion, ctx))
  }
  return outcomes
}
