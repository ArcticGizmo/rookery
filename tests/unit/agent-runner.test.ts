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

  it('omits subagent provenance for top-level messages', () => {
    const [event] = collect([msg.assistant([{ type: 'text', text: 'hi' }])])
    expect(event).toEqual({ kind: 'text', text: 'hi' })
  })

  it('attributes subagent text/tool_use via parent_tool_use_id + subagent_type', () => {
    const events = collect([
      msg.assistant(
        [
          { type: 'text', text: 'sub thinking' },
          { type: 'tool_use', id: 'tu2', name: 'Grep', input: { q: 'x' } }
        ],
        undefined,
        { parent_tool_use_id: 'task-1', subagent_type: 'code-reviewer' }
      )
    ])
    expect(events[0]).toEqual({
      kind: 'text',
      text: 'sub thinking',
      parentToolUseId: 'task-1',
      subagentType: 'code-reviewer'
    })
    expect(events[1]).toMatchObject({
      kind: 'tool_use',
      toolName: 'Grep',
      parentToolUseId: 'task-1',
      subagentType: 'code-reviewer'
    })
  })

  it('emits tool_result from a user message, flattening + truncating content', () => {
    const [event] = collect([
      msg.toolResult('tu1', [{ type: 'text', text: 'file contents' }], {
        parent_tool_use_id: 'task-1'
      })
    ])
    expect(event).toEqual({
      kind: 'tool_result',
      toolUseId: 'tu1',
      isError: false,
      content: 'file contents',
      parentToolUseId: 'task-1'
    })
  })

  it('marks errored tool results', () => {
    const [event] = collect([msg.toolResult('tu1', 'boom', { is_error: true })])
    expect(event).toMatchObject({ kind: 'tool_result', isError: true, content: 'boom' })
  })

  it('emits permission_denied with subagent attribution', () => {
    const [event] = collect([
      msg.permissionDenied('Bash', {
        tool_use_id: 'tu9',
        agent_id: 'sub-3',
        decision_reason: 'blocked by deny rule'
      })
    ])
    expect(event).toEqual({
      kind: 'permission_denied',
      toolName: 'Bash',
      toolUseId: 'tu9',
      reason: 'blocked by deny rule',
      subagentId: 'sub-3'
    })
  })

  it('emits task lifecycle events for background/sub-agent tasks', () => {
    const started = collect([msg.task('task_started', { task_id: 't1', subagent_type: 'general' })])
    expect(started[0]).toMatchObject({ kind: 'task', taskId: 't1', phase: 'started', subagentType: 'general' })

    const done = collect([msg.task('task_notification', { task_id: 't1', status: 'completed', summary: 'ok' })])
    expect(done[0]).toMatchObject({ kind: 'task', phase: 'completed', summary: 'ok' })
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
