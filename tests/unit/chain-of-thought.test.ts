import { describe, expect, it } from 'vitest'
import { buildChainOfThought } from '../../src/shared/chain-of-thought'
import type { StoredEvent } from '../../src/shared/events'

let seq = 0
function ev(type: string, payload: Record<string, unknown> = {}): StoredEvent {
  seq += 1
  return {
    id: seq,
    ts: `2026-07-02T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type: type as StoredEvent['type'],
    actor: 'agent',
    runId: 'r1',
    stageId: null,
    payload
  }
}

describe('buildChainOfThought', () => {
  it('drops pure telemetry (usage, context pressure) and empty messages', () => {
    const items = buildChainOfThought(
      [
        ev('agent.usage', { agentRunId: 'a' }),
        ev('agent.context_pressure', { percent: 40 }),
        ev('agent.message', { text: '   ' }),
        ev('agent.message', { text: 'thinking about it' })
      ],
      0
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'event' })
  })

  it('pairs a tool_use with its tool_result into one expandable item', () => {
    const items = buildChainOfThought(
      [
        ev('agent.tool_use', { toolUseId: 't1', toolName: 'Read', input: { file: 'a.ts' } }),
        ev('agent.tool_result', { toolUseId: 't1', content: 'file contents', isError: false })
      ],
      0
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      tool: { toolName: 'Read', result: 'file contents', isError: false }
    })
  })

  it('marks a failed tool result as an error', () => {
    const [item] = buildChainOfThought(
      [
        ev('agent.tool_use', { toolUseId: 't1', toolName: 'Bash' }),
        ev('agent.tool_result', { toolUseId: 't1', content: 'boom', isError: true })
      ],
      0
    )
    expect(item).toMatchObject({ kind: 'tool', tool: { isError: true, result: 'boom' } })
  })

  it('keeps a tool call even when its result lands after the window cut', () => {
    // tool_use is 4th-from-last; its result is last. With limit 5 both fit and the
    // result is folded in even though the tool_use event came earlier.
    const [tool] = buildChainOfThought(
      [
        ev('agent.tool_use', { toolUseId: 't1', toolName: 'Grep', input: 'x' }),
        ev('agent.message', { text: 'a' }),
        ev('agent.message', { text: 'b' }),
        ev('agent.message', { text: 'c' }),
        ev('agent.tool_result', { toolUseId: 't1', content: 'match', isError: false })
      ],
      5
    ).filter((i) => i.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', tool: { result: 'match' } })
  })

  it('returns only the last `limit` items, in chronological order', () => {
    const events = Array.from({ length: 8 }, (_, i) => ev('agent.message', { text: `m${i}` }))
    const items = buildChainOfThought(events, 3)
    expect(items).toHaveLength(3)
    const texts = items.map((i) =>
      i.kind === 'event' ? (i.event.payload as { text: string }).text : ''
    )
    expect(texts).toEqual(['m5', 'm6', 'm7'])
  })

  it('includes run/stage transitions as event items', () => {
    const items = buildChainOfThought(
      [
        ev('run.stage_entered', { stageName: 'Review', iteration: 1 }),
        ev('run.gate_awaiting', { description: 'approve' })
      ],
      0
    )
    expect(items.map((i) => (i.kind === 'event' ? i.event.type : 'tool'))).toEqual([
      'run.stage_entered',
      'run.gate_awaiting'
    ])
  })
})
