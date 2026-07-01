import { describe, expect, it } from 'vitest'
import { isBlank } from '@shared/index'

describe('isBlank', () => {
  it('is true for empty and whitespace-only strings', () => {
    expect(isBlank('')).toBe(true)
    expect(isBlank('   ')).toBe(true)
    expect(isBlank('\t\n')).toBe(true)
  })

  it('is false for strings with content', () => {
    expect(isBlank('rookery')).toBe(false)
    expect(isBlank('  x  ')).toBe(false)
  })
})
