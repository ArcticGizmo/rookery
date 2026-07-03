import { randomUUID } from 'node:crypto'
import { computeContextPressure, contextWindowForModel } from '@shared/context-pressure'
import { type AgentRunConfig, type CredentialStatus, agentRunConfigSchema } from '@shared/domain'
import { startAgentRun } from '../agent/agent-runner'
import { detectCredentials } from '../agent/credentials'
import { mapPersonaToOptions } from '../agent/persona-mapping'
import type { AgentResult, AgentRunHandle, AgentRunnerEvent, QueryFn } from '../agent/types'
import type { AppendInput, AuditLog } from './audit-log'

/** Optional audit scope so agent events can be tied to an orchestration run. */
export interface AgentScope {
  flightId?: string | null
  stageId?: string | null
}

interface FlightState {
  handle: AgentRunHandle
  /** Resolved model id (updated from the init event); drives context window. */
  model: string
  /** Serializes audit appends so events land in emission order. */
  tail: Promise<unknown>
  /** Flight/stage this agent belongs to (null for standalone single-agent flights). */
  scope: { flightId: string | null; stageId: string | null }
}

/**
 * Flights single agents via the Agent SDK and projects their activity into the
 * audit log (Phase 3.4–3.6). Holds no credentials; `queryFn` is injected so the
 * translation logic is unit-testable without spawning the CLI.
 */
export class AgentService {
  private readonly active = new Map<string, FlightState>()

  constructor(
    private readonly audit: AuditLog,
    private readonly queryFn: QueryFn
  ) {}

  credentials(): CredentialStatus {
    return detectCredentials()
  }

  /** Start an agent run; returns its id. Events flow to the audit log. */
  start(rawConfig: AgentRunConfig): { agentRunId: string } {
    const { agentRunId } = this.launch(rawConfig)
    return { agentRunId }
  }

  /**
   * Flight an agent to completion, projecting its activity to the audit log and
   * resolving with the collected result. Used by the orchestration engine to
   * drive stage agents and criterion checks.
   */
  async run(rawConfig: AgentRunConfig, scope?: AgentScope): Promise<AgentResult> {
    let text = ''
    let resultText = ''
    let isError = false
    let subtype = 'success'
    const { agentRunId, done } = this.launch(
      rawConfig,
      (event) => {
        if (event.kind === 'text') text += (text ? '\n' : '') + event.text
        else if (event.kind === 'result') {
          resultText = event.resultText
          isError = event.isError
          subtype = event.subtype
        } else if (event.kind === 'error') {
          isError = true
          subtype = 'error'
          resultText = event.message
        }
      },
      scope
    )
    await done
    return { agentRunId, text, resultText: resultText || text, isError, subtype }
  }

  /** Set up a run: parse config, register it, emit `agent.spawned`, and start
   * consuming the SDK stream. `extra` observes normalized events for callers
   * that need the result. */
  private launch(
    rawConfig: AgentRunConfig,
    extra?: (event: AgentRunnerEvent) => void,
    scope?: AgentScope
  ): { agentRunId: string; done: Promise<void> } {
    const config = agentRunConfigSchema.parse(rawConfig)
    const agentRunId = randomUUID()
    const options = mapPersonaToOptions(config.persona, {
      cwd: config.cwd,
      permissionMode: config.permissionMode
    })

    const state: FlightState = {
      handle: { done: Promise.resolve(), cancel: () => {} },
      model: config.persona.model ?? 'default',
      tail: Promise.resolve(),
      scope: { flightId: scope?.flightId ?? null, stageId: scope?.stageId ?? null }
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
      emit: (event) => {
        this.project(agentRunId, state, event)
        extra?.(event)
      }
    })

    return { agentRunId, done: state.handle.done }
  }

  /** Cancel a running agent. No-op if unknown/already finished. */
  cancel(agentRunId: string): void {
    const state = this.active.get(agentRunId)
    if (!state) return
    state.handle.cancel()
    this.enqueue(state, { type: 'agent.cancelled', actor: 'human', payload: { agentRunId } })
    this.active.delete(agentRunId)
  }

  /** Cancel every active agent belonging to a run (used when a run is terminated).
   * Snapshots the matching ids first, since `cancel` mutates the active map. */
  cancelByFlight(flightId: string): void {
    const ids = [...this.active.entries()]
      .filter(([, state]) => state.scope.flightId === flightId)
      .map(([agentRunId]) => agentRunId)
    for (const agentRunId of ids) this.cancel(agentRunId)
  }

  private project(agentRunId: string, state: FlightState, event: AgentRunnerEvent): void {
    switch (event.kind) {
      case 'init':
        state.model = event.model
        break
      case 'text':
        this.enqueue(state, {
          type: 'agent.message',
          actor: 'agent',
          payload: {
            agentRunId,
            text: event.text,
            ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}),
            ...(event.subagentType ? { subagentType: event.subagentType } : {})
          }
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
            input: event.input,
            ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}),
            ...(event.subagentType ? { subagentType: event.subagentType } : {})
          }
        })
        break
      case 'tool_result':
        this.enqueue(state, {
          type: 'agent.tool_result',
          actor: 'agent',
          payload: {
            agentRunId,
            toolUseId: event.toolUseId,
            isError: event.isError,
            content: event.content,
            ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {})
          }
        })
        break
      case 'permission_denied':
        this.enqueue(state, {
          type: 'agent.permission_denied',
          actor: 'agent',
          payload: {
            agentRunId,
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            reason: event.reason,
            ...(event.subagentId ? { subagentId: event.subagentId } : {})
          }
        })
        break
      case 'task':
        this.enqueue(state, {
          type: 'agent.task',
          actor: 'agent',
          payload: {
            agentRunId,
            taskId: event.taskId,
            phase: event.phase,
            summary: event.summary,
            ...(event.subagentType ? { subagentType: event.subagentType } : {}),
            ...(event.toolUseId ? { toolUseId: event.toolUseId } : {})
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
  private enqueue(state: FlightState, event: AppendInput): void {
    const scoped: AppendInput = {
      ...event,
      flightId: event.flightId ?? state.scope.flightId,
      stageId: event.stageId ?? state.scope.stageId
    }
    state.tail = state.tail
      .then(() => this.audit.append(scoped))
      .catch((error) => console.error('Failed to append agent event:', error))
  }
}
