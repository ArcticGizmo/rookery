import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/** The Agent SDK `query()` function signature — injected so runs are testable. */
export type QueryFn = (args: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}) => Query

/**
 * Normalized events emitted by the runner as it consumes the SDK stream. The
 * agent service adds the `agentRunId` and forwards these to the audit log.
 */
export type AgentRunnerEvent =
  | { kind: 'init'; model: string; cwd: string; apiKeySource: string; tools: string[] }
  | { kind: 'text'; text: string; parentToolUseId?: string | null; subagentType?: string | null }
  | {
      kind: 'tool_use'
      toolUseId: string
      toolName: string
      input: unknown
      parentToolUseId?: string | null
      subagentType?: string | null
    }
  | {
      kind: 'tool_result'
      toolUseId: string
      isError: boolean
      content: string
      parentToolUseId?: string | null
    }
  | {
      kind: 'permission_denied'
      toolName: string
      toolUseId: string
      reason: string
      subagentId?: string | null
    }
  | {
      kind: 'task'
      taskId: string
      phase: 'started' | 'progress' | 'completed' | 'failed' | 'stopped'
      summary: string
      subagentType?: string | null
      toolUseId?: string | null
    }
  | {
      kind: 'usage'
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    }
  | {
      kind: 'result'
      subtype: string
      isError: boolean
      numTurns: number
      totalCostUsd: number | null
      stopReason: string | null
      resultText: string
    }
  | { kind: 'error'; message: string }

/** The collected outcome of an agent run (used by the orchestration engine). */
export interface AgentResult {
  agentRunId: string
  /** Concatenated assistant text across the run. */
  text: string
  /** The SDK's final result string (falls back to `text` when absent). */
  resultText: string
  isError: boolean
  subtype: string
}

export interface AgentRunHandle {
  /** Resolves when the run finishes (normally, on error, or after cancel). */
  done: Promise<void>
  /** Abort the run: signals the SDK and terminates the CLI subprocess. */
  cancel: () => void
}
