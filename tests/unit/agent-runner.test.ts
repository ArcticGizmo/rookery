import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { startAgentRun, translateMessage } from '../../src/main/agent/agent-runner'
import type { AgentRunnerEvent } from '../../src/main/agent/types'
import { fakeQuery, msg } from './helpers/fake-query'

function collect(messages: unknown[]): AgentRunnerEvent[] {
  const events: AgentRunnerEvent[] = []
  for (const m of messages) translateMessage(m as SDKMessage, (e) => events.push(e))
  return events
}

describe('translateMessage', () => {
  it('emits init for the system/init message', () => {
    const [event] = collect([msg.init('claude-opus-4-8', ['Read'])])
    expect(event).toMatchObject({ kind: 'init', model: 'claude-opus-4-8', tools: ['Read'] })
  })

  it('emits text, tool_use, and usage from an assistant message', () => {
    const events = collect([
      msg.assistant(
        [
          { type: 'text', text: 'Looking at the file' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file: 'a.ts' } }
        ],
        { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 }
      )
    ])
    expect(events).toEqual([
      { kind: 'text', text: 'Looking at the file' },
      { kind: 'tool_use', toolUseId: 'tu1', toolName: 'Read', input: { file: 'a.ts' } },
      {
        kind: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheCreationTokens: 0
      }
    ])
  })

  it('emits usage then result for the result message', () => {
    const events = collect([msg.result({ num_turns: 3, stop_reason: 'end_turn' })])
    expect(events[0]!.kind).toBe('usage')
    expect(events[1]).toMatchObject({ kind: 'result', numTurns: 3, isError: false })
  })
})

describe('startAgentRun', () => {
  it('drains a completed stream to done', async () => {
    const events: AgentRunnerEvent[] = []
    const handle = startAgentRun({
      prompt: 'go',
      options: {},
      queryFn: fakeQuery([msg.init('claude-opus-4-8'), msg.result()]),
      emit: (e) => events.push(e)
    })
    await handle.done
    expect(events.map((e) => e.kind)).toEqual(['init', 'usage', 'result'])
  })

  it('stops cleanly on cancel without emitting an error', async () => {
    const events: AgentRunnerEvent[] = []
    const handle = startAgentRun({
      prompt: 'go',
      options: {},
      queryFn: fakeQuery([msg.init('claude-opus-4-8')], { hangUntilAbort: true }),
      emit: (e) => events.push(e)
    })
    handle.cancel()
    await handle.done
    expect(events.some((e) => e.kind === 'error')).toBe(false)
    expect(events[0]!.kind).toBe('init')
  })
})
