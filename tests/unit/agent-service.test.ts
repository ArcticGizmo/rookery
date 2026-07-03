import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentRunConfig } from '../../src/shared/domain'
import { AgentService } from '../../src/main/services/agent-service'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import type { StoredEvent } from '../../src/shared/events'
import { fakeQuery, msg } from './helpers/fake-query'

const CONFIG: AgentRunConfig = {
  persona: { id: 'p1', name: 'Reviewer', role: 'Reviewer', systemPrompt: 'Review.' },
  prompt: 'Review the repo',
  cwd: 'C:/git/api',
  permissionMode: 'plan'
}

async function waitFor(
  audit: AuditLog,
  predicate: (events: StoredEvent[]) => boolean
): Promise<StoredEvent[]> {
  for (let i = 0; i < 200; i++) {
    const events = await audit.list()
    if (predicate(events)) return events
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('Condition not met before timeout')
}

const types = (events: StoredEvent[]) => events.map((e) => e.type)

describe('AgentService', () => {
  let audit: AuditLog

  beforeEach(() => {
    audit = new AuditLog(new InMemoryEventStore())
  })

  it('projects a full run into ordered audit events with context pressure', async () => {
    const query = fakeQuery([
      msg.init('claude-opus-4-8', ['Read']),
      msg.assistant(
        [
          { type: 'text', text: 'Reviewing' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file: 'a.ts' } }
        ],
        { input_tokens: 100, cache_read_input_tokens: 50 }
      ),
      msg.result()
    ])
    const service = new AgentService(audit, query)

    const { agentRunId } = service.start(CONFIG)
    expect(agentRunId).toBeTruthy()

    const events = await waitFor(audit, (e) => e.some((x) => x.type === 'agent.finished'))
    const t = types(events)
    expect(t[0]).toBe('agent.spawned')
    expect(t).toContain('agent.message')
    expect(t).toContain('agent.tool_use')
    expect(t).toContain('agent.usage')
    expect(t).toContain('agent.context_pressure')
    expect(t[t.length - 1]).toBe('agent.finished')

    // Every event is tagged with the run id.
    expect(events.every((e) => (e.payload as { agentRunId: string }).agentRunId === agentRunId))

    // Context window resolved from the init model (Opus → 1M).
    const pressure = events.find((e) => e.type === 'agent.context_pressure')!
    expect((pressure.payload as { contextWindow: number }).contextWindow).toBe(1_000_000)
  })

  it('audits sub-agent activity, tool results, denials, and background tasks', async () => {
    const query = fakeQuery([
      msg.init('claude-opus-4-8'),
      // A subagent's text + tool call (forwarded), then its tool result.
      msg.assistant([{ type: 'text', text: 'sub work' }], undefined, {
        parent_tool_use_id: 'task-1',
        subagent_type: 'code-reviewer'
      }),
      msg.toolResult('tu1', 'ok', { parent_tool_use_id: 'task-1' }),
      msg.permissionDenied('Bash', { agent_id: 'sub-1', decision_reason: 'deny rule' }),
      msg.task('task_notification', { task_id: 'task-1', status: 'completed', summary: 'done' }),
      msg.result()
    ])
    const service = new AgentService(audit, query)
    const { agentRunId } = service.start(CONFIG)

    const events = await waitFor(audit, (e) => e.some((x) => x.type === 'agent.finished'))
    const t = types(events)
    expect(t).toContain('agent.tool_result')
    expect(t).toContain('agent.permission_denied')
    expect(t).toContain('agent.task')

    const message = events.find((e) => e.type === 'agent.message')!
    expect((message.payload as { subagentType: string }).subagentType).toBe('code-reviewer')
    expect((message.payload as { parentToolUseId: string }).parentToolUseId).toBe('task-1')

    const denied = events.find((e) => e.type === 'agent.permission_denied')!
    expect((denied.payload as { subagentId: string }).subagentId).toBe('sub-1')
    // Everything, including nested activity, is tagged with the run id.
    expect(
      events.every((e) => (e.payload as { agentRunId?: string }).agentRunId === undefined || (e.payload as { agentRunId: string }).agentRunId === agentRunId)
    ).toBe(true)
  })

  it('emits agent.cancelled when a running agent is cancelled', async () => {
    const query = fakeQuery([msg.init('claude-opus-4-8')], { hangUntilAbort: true })
    const service = new AgentService(audit, query)

    const { agentRunId } = service.start(CONFIG)
    await waitFor(audit, (e) => e.some((x) => x.type === 'agent.spawned'))

    service.cancel(agentRunId)
    const events = await waitFor(audit, (e) => e.some((x) => x.type === 'agent.cancelled'))
    const cancelled = events.find((e) => e.type === 'agent.cancelled')!
    expect(cancelled.actor).toBe('human')
    expect((cancelled.payload as { agentRunId: string }).agentRunId).toBe(agentRunId)
  })
})
