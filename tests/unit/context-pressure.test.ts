import { describe, expect, it } from 'vitest'
import {
  computeContextPressure,
  contextWindowForModel,
  levelForPercent
} from '../../src/shared/context-pressure'

describe('contextWindowForModel', () => {
  it('maps model families to windows', () => {
    expect(contextWindowForModel('claude-opus-4-8')).toBe(1_000_000)
    expect(contextWindowForModel('claude-sonnet-5')).toBe(1_000_000)
    expect(contextWindowForModel('claude-fable-5')).toBe(1_000_000)
    expect(contextWindowForModel('claude-haiku-4-5')).toBe(200_000)
  })

  it('falls back to a default for unknown models', () => {
    expect(contextWindowForModel('mystery-model')).toBe(200_000)
  })
})

describe('levelForPercent', () => {
  it('thresholds at 70% (warn) and 90% (high)', () => {
    expect(levelForPercent(50)).toBe('ok')
    expect(levelForPercent(69.9)).toBe('ok')
    expect(levelForPercent(70)).toBe('warn')
    expect(levelForPercent(89.9)).toBe('warn')
    expect(levelForPercent(90)).toBe('high')
    expect(levelForPercent(150)).toBe('high')
  })
})

describe('computeContextPressure', () => {
  it('computes percent rounded to one decimal', () => {
    const p = computeContextPressure(700_000, 1_000_000)
    expect(p.percent).toBe(70)
    expect(p.level).toBe('warn')
    expect(p.contextWindow).toBe(1_000_000)
    expect(p.usedTokens).toBe(700_000)
  })

  it('flags high near the window', () => {
    expect(computeContextPressure(950_000, 1_000_000).level).toBe('high')
  })

  it('guards against a zero/invalid window', () => {
    const p = computeContextPressure(1000, 0)
    expect(p.contextWindow).toBe(200_000)
    expect(Number.isFinite(p.percent)).toBe(true)
  })
})
