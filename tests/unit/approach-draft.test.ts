import { describe, expect, it } from 'vitest'
import { parseApproachDraft } from '../../src/shared/approach-draft'

// Deterministic ids so assertions are stable.
function seq() {
  let n = 0
  return () => `id${++n}`
}

describe('parseApproachDraft', () => {
  it('parses a fenced JSON proposal into a validated approach for the brief', () => {
    const reply = [
      "Here's a plan:",
      '```json',
      JSON.stringify({
        name: 'Rate-limit the API',
        stages: [
          {
            name: 'Review',
            type: 'review',
            roles: [{ name: 'Tech Lead', role: 'Reviewer', systemPrompt: 'Review the spec.' }],
            done: ['manual'],
            hold: true
          },
          {
            name: 'Build',
            type: 'implementation',
            roles: [{ name: 'Engineer', role: 'Implementer', systemPrompt: 'Do it.' }],
            done: ['reviewer_approves'],
            hold: false
          }
        ]
      }),
      '```'
    ].join('\n')

    const result = parseApproachDraft(reply, 'brief-1', seq())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.briefId).toBe('brief-1')
    expect(result.body.name).toBe('Rate-limit the API')
    expect(result.body.stages).toHaveLength(2)
    expect(result.body.stages[0]).toMatchObject({ name: 'Review', type: 'review' })
    expect(result.body.stages[0]!.personas[0]).toMatchObject({ role: 'Reviewer' })
    expect(result.body.stages[0]!.doneCriteria[0]!.type).toBe('manual')
    // hold:true → a human checkpoint; hold:false → none.
    expect(result.body.stages[0]!.checkpoints).toHaveLength(1)
    expect(result.body.stages[0]!.checkpoints[0]!.kind).toBe('human')
    expect(result.body.stages[1]!.checkpoints).toHaveLength(0)
    // Every entity gets an id.
    expect(result.body.stages[0]!.id).toBeTruthy()
  })

  it('extracts JSON even without a code fence', () => {
    const reply = 'Sure!\n{"name":"X","stages":[{"name":"Verify","type":"verification","done":["tests_pass"]}]}\nHope that helps.'
    const result = parseApproachDraft(reply, 'b', seq())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.stages[0]).toMatchObject({ type: 'verification' })
    expect(result.body.stages[0]!.doneCriteria[0]!.type).toBe('tests_pass')
  })

  it('coerces an unknown stage type to custom and drops unknown criteria', () => {
    const reply = JSON.stringify({
      stages: [{ name: 'Odd', type: 'deploy', done: ['tests_pass', 'ship_it'] }]
    })
    const result = parseApproachDraft(reply, 'b', seq())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.stages[0]!.type).toBe('custom')
    expect(result.body.stages[0]!.doneCriteria.map((c) => c.type)).toEqual(['tests_pass'])
  })

  it('fails clearly when there is no JSON', () => {
    const result = parseApproachDraft('I could not produce a plan.', 'b', seq())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/recognizable approach/)
  })

  it('fails clearly on malformed JSON', () => {
    const result = parseApproachDraft('```json\n{ not: valid }\n```', 'b', seq())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/malformed/)
  })

  it('fails when the proposal has no steps', () => {
    const result = parseApproachDraft('{"name":"Empty","stages":[]}', 'b', seq())
    expect(result.ok).toBe(false)
  })
})
