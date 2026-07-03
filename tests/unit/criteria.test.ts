import { describe, expect, it, vi } from 'vitest'
import type { PassCriterionType, Stage } from '../../src/shared/domain'
import type { AgentResult } from '../../src/main/agent/types'
import { evaluateCriteria } from '../../src/main/engine/criteria'

function stageWith(type: PassCriterionType): Stage {
  return {
    id: 's',
    name: 'Stage',
    type: 'review',
    personas: [],
    passCriteria: [{ id: 'c', type, description: '' }],
    checkpoints: []
  }
}

function fakeAgent(resultText: string, isError = false): () => Promise<AgentResult> {
  return () => Promise.resolve({ agentRunId: 'a', text: '', resultText, isError, subtype: 'success' })
}

const ctx = (runAgent: () => Promise<AgentResult>) => ({
  spec: 'spec',
  cwd: null,
  agentResults: [],
  runAgent
})

describe('evaluateCriteria', () => {
  it('passes manual criteria without invoking an agent', async () => {
    const runAgent = vi.fn(fakeAgent('unused'))
    const [outcome] = await evaluateCriteria(stageWith('manual'), ctx(runAgent))
    expect(outcome!.passed).toBe(true)
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('passes reviewer_approves on APPROVE, fails on REJECT', async () => {
    const approve = await evaluateCriteria(stageWith('reviewer_approves'), ctx(fakeAgent('APPROVE, looks good')))
    expect(approve[0]!.passed).toBe(true)
    const reject = await evaluateCriteria(stageWith('reviewer_approves'), ctx(fakeAgent('REJECT: needs tests')))
    expect(reject[0]!.passed).toBe(false)
  })

  it('treats an unclear verdict as a failure', async () => {
    const [outcome] = await evaluateCriteria(stageWith('reviewer_approves'), ctx(fakeAgent('hmm, maybe')))
    expect(outcome!.passed).toBe(false)
    expect(outcome!.detail).toContain('Unclear')
  })

  it('fails when both tokens appear (conservative)', async () => {
    const [outcome] = await evaluateCriteria(
      stageWith('reviewer_approves'),
      ctx(fakeAgent('I would APPROVE but must REJECT for now'))
    )
    expect(outcome!.passed).toBe(false)
  })

  it('reads the verdict from a later line when the agent leads with reasoning', async () => {
    const [outcome] = await evaluateCriteria(
      stageWith('reviewer_approves'),
      ctx(
        fakeAgent(
          'I have enough to judge. The source file confirms the state.\n\nREJECT\n\nThe stub is unimplemented.'
        )
      )
    )
    expect(outcome!.passed).toBe(false)
    // Detail is the verdict line, not the reasoning preamble (audit clarity).
    expect(outcome!.detail).toBe('REJECT')
  })

  it('does not flip a genuine APPROVE because prose later mentions the reject token', async () => {
    const [outcome] = await evaluateCriteria(
      stageWith('reviewer_approves'),
      ctx(fakeAgent('APPROVE\n\nNo changes needed; I considered whether to reject over naming but it is fine.'))
    )
    expect(outcome!.passed).toBe(true)
    expect(outcome!.detail).toBe('APPROVE')
  })

  it('passes tests_pass on PASS', async () => {
    const [outcome] = await evaluateCriteria(stageWith('tests_pass'), ctx(fakeAgent('PASS — 42 tests green')))
    expect(outcome!.passed).toBe(true)
  })

  it('fails when the checker agent errors', async () => {
    const [outcome] = await evaluateCriteria(
      stageWith('personas_agree'),
      ctx(fakeAgent('boom', true))
    )
    expect(outcome!.passed).toBe(false)
    expect(outcome!.detail).toContain('errored')
  })
})
