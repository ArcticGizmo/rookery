import { randomUUID } from 'node:crypto'
import { computeContextPressure, contextWindowForModel } from '@shared/context-pressure'
import { type AgentRunConfig, type CredentialStatus, agentRunConfigSchema } from '@shared/domain'
import { startAgentRun } from '../agent/agent-runner'
import { detectCredentials } from '../agent/credentials'
import { mapPersonaToOptions } from '../agent/persona-mapping'
import type { AgentRunHandle, AgentRunnerEvent, QueryFn } from '../agent/types'
import type { AppendInput, AuditLog } from './audit-log'

interface RunState {
  handle: AgentRunHandle
  /** Resolved model id (updated from the init event); drives context window. */
  model: string
  /** Serializes audit appends so events land in emission order. */
  tail: Promise<unknown>
}

/**
 * Runs single agents via the Agent SDK and projects their activity into the
 * audit log (Phase 3.4–3.6). Holds no credentials; `queryFn` is injected so the
 * translation logic is unit-testable without spawning the CLI.
 */
export class AgentService {
  private readonly active = new Map<string, RunState>()

  constructor(
    private readonly audit: AuditLog,
    private readonly queryFn: QueryFn
  ) {}

  credentials(): CredentialStatus {
    return detectCredentials()
  }

  /** Start an agent run; returns its id. Events flow to the audit log. */
  start(rawConfig: AgentRunConfig): { agentRunId: string } {
    const config = agentRunConfigSchema.parse(rawConfig)
    const agentRunId = randomUUID()
    const options = mapPersonaToOptions(config.persona, {
      cwd: config.cwd,
      permissionMode: config.permissionMode
    })

    const state: RunState = {
      handle: { done: Promise.resolve(), cancel: () => {} },
      model: config.persona.model ?? 'default',
      tail: Promise.resolve()
    }
    this.active.set(agentRunId, state)

    this.enqueue(state, {
      type: 'agent.spawned',
      actor: 'agent',
      payload: {
        agentRunId,
        personaName: config.persona.name,
        model: state.model,
        cwd: config.cwd ?? null
      }
    })

    state.handle = startAgentRun({
      prompt: config.prompt,
      options,
      queryFn: this.queryFn,
      emit: (event) => this.onEvent(agentRunId, state, event)
    })

    return { agentRunId }
  }

  /** Cancel a running agent. No-op if unknown/already finished. */
  cancel(agentRunId: string): void {
    const state = this.active.get(agentRunId)
    if (!state) return
    state.handle.cancel()
    this.enqueue(state, { type: 'agent.cancelled', actor: 'human', payload: { agentRunId } })
    this.active.delete(agentRunId)
  }

  private onEvent(agentRunId: string, state: RunState, event: AgentRunnerEvent): void {
    switch (event.kind) {
      case 'init':
        state.model = event.model
        break
      case 'text':
        this.enqueue(state, {
          type: 'agent.message',
          actor: 'agent',
          payload: { agentRunId, text: event.text }
        })
        break
      case 'tool_use':
        this.enqueue(state, {
          type: 'agent.tool_use',
          actor: 'agent',
          payload: {
            agentRunId,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            input: event.input
          }
        })
        break
      case 'usage': {
        this.enqueue(state, {
          type: 'agent.usage',
          actor: 'agent',
          payload: {
            agentRunId,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheCreationTokens: event.cacheCreationTokens
          }
        })
        const usedTokens = event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens
        const pressure = computeContextPressure(usedTokens, contextWindowForModel(state.model))
        this.enqueue(state, {
          type: 'agent.context_pressure',
          actor: 'agent',
          payload: { agentRunId, ...pressure }
        })
        break
      }
      case 'result':
        this.enqueue(state, {
          type: 'agent.finished',
          actor: 'agent',
          payload: {
            agentRunId,
            subtype: event.subtype,
            isError: event.isError,
            numTurns: event.numTurns,
            totalCostUsd: event.totalCostUsd,
            stopReason: event.stopReason
          }
        })
        this.active.delete(agentRunId)
        break
      case 'error':
        this.enqueue(state, {
          type: 'agent.error',
          actor: 'agent',
          payload: { agentRunId, message: event.message }
        })
        this.active.delete(agentRunId)
        break
    }
  }

  /** Append in emission order; failures are logged, never thrown into the loop. */
  private enqueue(state: RunState, event: AppendInput): void {
    state.tail = state.tail
      .then(() => this.audit.append(event))
      .catch((error) => console.error('Failed to append agent event:', error))
  }
}
