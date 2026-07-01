import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRunHandle, AgentRunnerEvent, QueryFn } from './types'

export interface StartRunParams {
  prompt: string
  options: Options
  queryFn: QueryFn
  emit: (event: AgentRunnerEvent) => void
}

function coalesce(value: number | null | undefined): number {
  return value ?? 0
}

/**
 * Translate one SDK message into zero or more normalized runner events.
 * Exported for unit testing against fabricated message streams.
 */
export function translateMessage(message: SDKMessage, emit: (e: AgentRunnerEvent) => void): void {
  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init') {
        emit({
          kind: 'init',
          model: message.model,
          cwd: message.cwd,
          apiKeySource: message.apiKeySource,
          tools: message.tools
        })
      }
      break
    }
    case 'assistant': {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          emit({ kind: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          emit({
            kind: 'tool_use',
            toolUseId: block.id,
            toolName: block.name,
            input: block.input
          })
        }
      }
      const usage = message.message.usage
      if (usage) {
        emit({
          kind: 'usage',
          inputTokens: coalesce(usage.input_tokens),
          outputTokens: coalesce(usage.output_tokens),
          cacheReadTokens: coalesce(usage.cache_read_input_tokens),
          cacheCreationTokens: coalesce(usage.cache_creation_input_tokens)
        })
      }
      break
    }
    case 'result': {
      emit({
        kind: 'usage',
        inputTokens: coalesce(message.usage.input_tokens),
        outputTokens: coalesce(message.usage.output_tokens),
        cacheReadTokens: coalesce(message.usage.cache_read_input_tokens),
        cacheCreationTokens: coalesce(message.usage.cache_creation_input_tokens)
      })
      emit({
        kind: 'result',
        subtype: message.subtype,
        isError: message.is_error,
        numTurns: message.num_turns,
        totalCostUsd: message.total_cost_usd ?? null,
        stopReason: message.stop_reason ?? null,
        resultText: 'result' in message ? message.result : ''
      })
      break
    }
    default:
      // Other message types (status, hook events, task progress, …) are not
      // surfaced by the single-agent view; ignore them.
      break
  }
}

/**
 * Start an agent run over the injected `query()` function (Phase 3.2). Consumes
 * the SDK stream, emits normalized events, and exposes a cancel handle (3.6).
 */
export function startAgentRun(params: StartRunParams): AgentRunHandle {
  const { prompt, options, queryFn, emit } = params
  const abortController = new AbortController()

  const query = queryFn({ prompt, options: { ...options, abortController } })

  const done = (async () => {
    try {
      for await (const message of query) {
        translateMessage(message, emit)
      }
    } catch (error) {
      if (abortController.signal.aborted) return // expected on cancel
      emit({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })()

  return {
    done,
    cancel: () => {
      abortController.abort()
      query.close()
    }
  }
}
