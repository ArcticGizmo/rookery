import type { AgentPersona, DoneCriterion, PermissionMode, Stage } from '@shared/domain'
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
  criterion: DoneCriterion
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

/**
 * Decide pass/fail from a checker agent's verdict. The checker is asked to put
 * its verdict token on the first line, but agents routinely lead with a line or
 * two of reasoning, so we scan for the first *line* that actually carries a
 * verdict token rather than matching across the whole blob. Whole-blob matching
 * was doubly wrong: the token often appears in explanatory prose ("I won't
 * reject this…"), flipping a genuine pass to a fail; and the recorded detail was
 * the preamble line, not the verdict, which made failures hard to diagnose.
 *
 * The deciding line is the recorded detail, so the audit shows the real verdict.
 * Conservative: no token anywhere, or both tokens on the deciding line, is a fail.
 */
function verdict(
  result: AgentResult,
  positive: string,
  negative: string
): { passed: boolean; detail: string } {
  const text = result.resultText || result.text
  if (result.isError) return { passed: false, detail: `Checker errored: ${firstLine(text)}` }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const upper = line.toUpperCase()
    const hasNegative = upper.includes(negative)
    const hasPositive = upper.includes(positive)
    // Both tokens on one line is ambiguous — fail conservatively. Negative wins
    // over positive so an approval hedged with the reject token never passes.
    if (hasNegative) return { passed: false, detail: line.slice(0, 200) }
    if (hasPositive) return { passed: true, detail: line.slice(0, 200) }
  }
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

type Evaluator = (criterion: DoneCriterion, ctx: CriterionContext) => Promise<CriterionOutcome>

const EVALUATORS: Record<DoneCriterion['type'], Evaluator> = {
  manual: async (criterion) => ({
    criterion,
    passed: true,
    detail: 'Deferred to a human checkpoint.'
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
    // `acceptEdits` (not `bypassPermissions`) so the security deny backstop still
    // applies — the tester persona allow-lists Bash for running the suite.
    const result = await ctx.runAgent(testerPersona, prompt, 'acceptEdits')
    return { criterion, ...verdict(result, 'PASS', 'FAIL') }
  }
}

/** Evaluate all of a stage's pass criteria (Phase 4.5). Empty ⇒ vacuously passes. */
export async function evaluateCriteria(
  stage: Stage,
  ctx: CriterionContext
): Promise<CriterionOutcome[]> {
  const outcomes: CriterionOutcome[] = []
  for (const criterion of stage.doneCriteria) {
    outcomes.push(await EVALUATORS[criterion.type](criterion, ctx))
  }
  return outcomes
}
