import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRunHandle, AgentRunnerEvent, QueryFn } from './types'

export interface StartFlightParams {
  prompt: string
  options: Options
  queryFn: QueryFn
  emit: (event: AgentRunnerEvent) => void
}

function coalesce(value: number | null | undefined): number {
  return value ?? 0
}

const MAX_RESULT_LEN = 4000

/** Flatten a tool_result's content (string or content-block array) to text. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && 'type' in block) {
          const b = block as { type: string; text?: string }
          return b.type === 'text' && typeof b.text === 'string' ? b.text : `[${b.type}]`
        }
        return String(block)
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

function truncate(text: string): string {
  return text.length > MAX_RESULT_LEN ? `${text.slice(0, MAX_RESULT_LEN)}… (truncated)` : text
}

/** Provenance carried by subagent-produced messages, when present. */
function provenance(message: unknown): { parentToolUseId?: string; subagentType?: string } {
  const m = message as { parent_tool_use_id?: string | null; subagent_type?: string }
  const out: { parentToolUseId?: string; subagentType?: string } = {}
  if (m.parent_tool_use_id) out.parentToolUseId = m.parent_tool_use_id
  if (m.subagent_type) out.subagentType = m.subagent_type
  return out
}

/**
 * Translate one SDK message into zero or more normalized runner events.
 * Exported for unit testing against fabricated message streams. Subagent and
 * background-task activity is captured too (Phase 5 audit pass), so nothing an
 * orchestrated agent does — nested or not — escapes the audit log.
 */
export function translateMessage(message: SDKMessage, emit: (e: AgentRunnerEvent) => void): void {
  switch (message.type) {
    case 'system': {
      const sys = message as {
        subtype?: string
        model?: string
        cwd?: string
        apiKeySource?: string
        tools?: string[]
        tool_name?: string
        tool_use_id?: string
        agent_id?: string
        decision_reason?: string
        message?: string
        task_id?: string
        status?: string
        summary?: string
        description?: string
        subagent_type?: string
      }
      if (sys.subtype === 'init') {
        emit({
          kind: 'init',
          model: sys.model ?? 'unknown',
          cwd: sys.cwd ?? '',
          apiKeySource: sys.apiKeySource ?? '',
          tools: sys.tools ?? []
        })
      } else if (sys.subtype === 'permission_denied') {
        emit({
          kind: 'permission_denied',
          toolName: sys.tool_name ?? 'unknown',
          toolUseId: sys.tool_use_id ?? '',
          reason: sys.decision_reason || sys.message || 'denied',
          ...(sys.agent_id ? { subagentId: sys.agent_id } : {})
        })
      } else if (
        sys.subtype === 'task_started' ||
        sys.subtype === 'task_progress' ||
        sys.subtype === 'task_notification'
      ) {
        const phase =
          sys.subtype === 'task_started'
            ? ('started' as const)
            : sys.subtype === 'task_progress'
              ? ('progress' as const)
              : ((sys.status as 'completed' | 'failed' | 'stopped') ?? 'completed')
        emit({
          kind: 'task',
          taskId: sys.task_id ?? '',
          phase,
          summary: sys.summary || sys.description || '',
          ...(sys.subagent_type ? { subagentType: sys.subagent_type } : {}),
          ...(sys.tool_use_id ? { toolUseId: sys.tool_use_id } : {})
        })
      }
      break
    }
    case 'assistant': {
      const prov = provenance(message)
      for (const block of message.message.content) {
        if (block.type === 'text') {
          emit({ kind: 'text', text: block.text, ...prov })
        } else if (block.type === 'tool_use') {
          emit({
            kind: 'tool_use',
            toolUseId: block.id,
            toolName: block.name,
            input: block.input,
            ...prov
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
    case 'user': {
      // Tool results come back as user messages carrying tool_result blocks.
      const prov = provenance(message)
      const content = (message as { message?: { content?: unknown } }).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as {
            type?: string
            tool_use_id?: string
            content?: unknown
            is_error?: boolean
          }
          if (b.type === 'tool_result') {
            emit({
              kind: 'tool_result',
              toolUseId: b.tool_use_id ?? '',
              isError: Boolean(b.is_error),
              content: truncate(stringifyContent(b.content)),
              ...(prov.parentToolUseId ? { parentToolUseId: prov.parentToolUseId } : {})
            })
          }
        }
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
      // Other message types (auth status, stream events, hook events, …) carry
      // no auditable agent action; ignore them.
      break
  }
}

/**
 * Start an agent run over the injected `query()` function (Phase 3.2). Consumes
 * the SDK stream, emits normalized events, and exposes a cancel handle (3.6).
 */
export function startAgentRun(params: StartFlightParams): AgentRunHandle {
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
