import type { QueryFn } from '../../../src/main/agent/types'

/**
 * A fake Agent SDK `query()` for tests: yields the given messages, then
 * (optionally) hangs until the run's AbortController fires — letting us exercise
 * cancellation without spawning the real CLI subprocess.
 */
export function fakeQuery(messages: unknown[], opts: { hangUntilAbort?: boolean } = {}): QueryFn {
  return ((args: { options?: { abortController?: AbortController } }) => {
    const signal = args.options?.abortController?.signal
    async function* gen(): AsyncGenerator<unknown> {
      for (const message of messages) yield message
      if (opts.hangUntilAbort) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve()
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    }
    const iterator = gen()
    ;(iterator as unknown as { close: () => void }).close = () => {}
    return iterator
  }) as unknown as QueryFn
}

/** Minimal SDK message factories (loosely typed — shape matches what we read). */
export const msg = {
  init: (model: string, tools: string[] = []) => ({
    type: 'system',
    subtype: 'init',
    model,
    cwd: '/tmp',
    apiKeySource: 'oauth',
    tools
  }),
  assistant: (
    content: unknown[],
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    },
    provenance?: { parent_tool_use_id?: string; subagent_type?: string }
  ) => ({ type: 'assistant', message: { content, usage }, ...provenance }),
  /** A user message carrying tool_result block(s) — how tool output comes back. */
  toolResult: (
    toolUseId: string,
    content: unknown,
    opts: { is_error?: boolean; parent_tool_use_id?: string } = {}
  ) => ({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: opts.is_error }]
    },
    parent_tool_use_id: opts.parent_tool_use_id ?? null
  }),
  permissionDenied: (
    toolName: string,
    opts: { tool_use_id?: string; agent_id?: string; decision_reason?: string } = {}
  ) => ({
    type: 'system',
    subtype: 'permission_denied',
    tool_name: toolName,
    tool_use_id: opts.tool_use_id ?? 'tu-denied',
    agent_id: opts.agent_id,
    decision_reason: opts.decision_reason ?? 'blocked by deny rule',
    message: 'denied'
  }),
  task: (
    subtype: 'task_started' | 'task_progress' | 'task_notification',
    opts: {
      task_id?: string
      status?: string
      summary?: string
      description?: string
      subagent_type?: string
      tool_use_id?: string
    } = {}
  ) => ({ type: 'system', subtype, task_id: opts.task_id ?? 't1', ...opts }),
  result: (overrides: Record<string, unknown> = {}) => ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    },
    total_cost_usd: 0.01,
    stop_reason: 'end_turn',
    ...overrides
  })
}
