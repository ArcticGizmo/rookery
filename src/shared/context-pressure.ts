/**
 * Context-pressure computation (Phase 3.5). Pure and shared so the engine can
 * emit pressure events and the UI can label them identically.
 *
 * "Used tokens" for a turn is the resident prompt size: input + cache-read +
 * cache-creation tokens (output is not counted — it becomes next turn's input,
 * where it is measured again). Pressure is that figure over the model's context
 * window. High pressure correlates with declining output quality, so the UI
 * surfaces a warning before the window is exhausted.
 */

export type PressureLevel = 'ok' | 'warn' | 'high'

/** Fraction of the context window at which we warn / flag high. */
export const PRESSURE_WARN = 0.7
export const PRESSURE_HIGH = 0.9

/** Fallback context window when the model is unknown. */
const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Context window (tokens) for a model id. Current Claude models expose 1M;
 * Haiku is 200K. Matched by substring so alias/date-suffixed ids resolve.
 */
export function contextWindowForModel(model: string): number {
  const id = model.toLowerCase()
  if (id.includes('haiku')) return 200_000
  if (
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('fable') ||
    id.includes('mythos')
  ) {
    return 1_000_000
  }
  return DEFAULT_CONTEXT_WINDOW
}

export function levelForPercent(percent: number): PressureLevel {
  if (percent >= PRESSURE_HIGH * 100) return 'high'
  if (percent >= PRESSURE_WARN * 100) return 'warn'
  return 'ok'
}

export interface ContextPressure {
  usedTokens: number
  contextWindow: number
  /** 0–100, rounded to one decimal (can exceed 100 if the window is overrun). */
  percent: number
  level: PressureLevel
}

export function computeContextPressure(usedTokens: number, contextWindow: number): ContextPressure {
  const window = contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW
  const percent = Math.round((usedTokens / window) * 1000) / 10
  return { usedTokens, contextWindow: window, percent, level: levelForPercent(percent) }
}
