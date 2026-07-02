/**
 * Compact "chain of thought" projection for the run view (Phase C1). Reduces a
 * run's raw event stream to the recent, meaningful moments — the agent's
 * messages, its tool calls (each paired with its result so the detail can be
 * expanded on demand), and run/stage/gate transitions — dropping pure telemetry
 * (token usage, context-pressure samples) that belongs in the full audit log.
 *
 * Pure and derived entirely from the event log, so it's unit-testable and the run
 * view stays a projection. The full, unfiltered history remains available via the
 * History page.
 */

import type { StoredEvent } from './events'

/** A tool call with its result folded in (for the expandable detail). */
export interface ChainTool {
  toolUseId: string
  toolName: string
  input: unknown
  /** Result text, or null until the tool_result arrives. */
  result: string | null
  isError: boolean
  subagentType: string | null
}

/** One entry in the chain: either a raw event (rendered by the view's labeller)
 * or a paired tool call. */
export type ChainItem =
  | { kind: 'event'; key: string; event: StoredEvent }
  | { kind: 'tool'; key: string; ts: string; tool: ChainTool }

/** Pure telemetry that would only clutter a compact chain (still in the log). */
const SKIP_TYPES = new Set(['agent.usage', 'agent.context_pressure'])

function payloadOf(event: StoredEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>
}

/**
 * Build the chain, keeping only the last `limit` items (0 ⇒ all). Tool calls are
 * created at their `tool_use` position and mutated in place when the matching
 * `tool_result` arrives, so a tool kept in the window always shows its result.
 */
export function buildChainOfThought(events: StoredEvent[], limit = 5): ChainItem[] {
  const items: ChainItem[] = []
  const toolByUseId = new Map<string, Extract<ChainItem, { kind: 'tool' }>>()

  for (const event of events) {
    if (SKIP_TYPES.has(event.type)) continue
    const p = payloadOf(event)

    if (event.type === 'agent.tool_use') {
      const toolUseId = String(p.toolUseId ?? '')
      const item: Extract<ChainItem, { kind: 'tool' }> = {
        kind: 'tool',
        key: `tool-${toolUseId || event.id}`,
        ts: event.ts,
        tool: {
          toolUseId,
          toolName: String(p.toolName ?? 'tool'),
          input: p.input ?? null,
          result: null,
          isError: false,
          subagentType: (p.subagentType as string | undefined) ?? null
        }
      }
      items.push(item)
      if (toolUseId) toolByUseId.set(toolUseId, item)
      continue
    }

    if (event.type === 'agent.tool_result') {
      // Fold the result into its tool call rather than emitting a separate item.
      const tool = toolByUseId.get(String(p.toolUseId ?? ''))
      if (tool) {
        tool.tool.result = String(p.content ?? '')
        tool.tool.isError = Boolean(p.isError)
      }
      continue
    }

    // Drop empty agent messages (no text to show).
    if (event.type === 'agent.message' && String(p.text ?? '').trim() === '') continue

    items.push({ kind: 'event', key: `ev-${event.id}`, event })
  }

  return limit > 0 ? items.slice(-limit) : items
}
