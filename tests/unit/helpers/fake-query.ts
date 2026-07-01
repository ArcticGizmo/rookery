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
    }
  ) => ({ type: 'assistant', message: { content, usage } }),
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
