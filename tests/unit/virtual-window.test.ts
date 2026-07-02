import { describe, expect, it } from 'vitest'
import { computeVirtualWindow } from '../../src/shared/virtual-window'

describe('computeVirtualWindow (Phase 7.4)', () => {
  const rowHeight = 32
  const viewportHeight = 320 // 10 rows visible

  it('renders from the top with overscan at scrollTop 0', () => {
    const w = computeVirtualWindow({ count: 1000, rowHeight, scrollTop: 0, viewportHeight })
    expect(w.startIndex).toBe(0)
    expect(w.offsetY).toBe(0)
    expect(w.totalHeight).toBe(1000 * rowHeight)
    // 10 visible + 8 overscan below (no overscan above at the top).
    expect(w.endIndex).toBe(18)
  })

  it('windows around the scroll position in the middle', () => {
    const w = computeVirtualWindow({ count: 1000, rowHeight, scrollTop: 3200, viewportHeight })
    // first visible row = 3200/32 = 100; overscan 8 each side.
    expect(w.startIndex).toBe(92)
    expect(w.endIndex).toBe(118)
    expect(w.offsetY).toBe(92 * rowHeight)
  })

  it('clamps the end index at the bottom of the list', () => {
    const totalHeight = 1000 * rowHeight
    const w = computeVirtualWindow({
      count: 1000,
      rowHeight,
      scrollTop: totalHeight,
      viewportHeight
    })
    expect(w.endIndex).toBe(1000)
    expect(w.startIndex).toBeLessThan(1000)
  })

  it('renders every row when the list is smaller than the viewport', () => {
    const w = computeVirtualWindow({ count: 3, rowHeight, scrollTop: 0, viewportHeight })
    expect(w.startIndex).toBe(0)
    expect(w.endIndex).toBe(3)
    expect(w.totalHeight).toBe(3 * rowHeight)
  })

  it('is a no-op-safe window for an empty list', () => {
    const w = computeVirtualWindow({ count: 0, rowHeight, scrollTop: 0, viewportHeight })
    expect(w).toEqual({ startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: 0 })
  })

  it('degrades gracefully before the viewport is measured (height 0)', () => {
    const w = computeVirtualWindow({ count: 50, rowHeight, scrollTop: 0, viewportHeight: 0 })
    // Renders all rows rather than nothing, so content is never invisible.
    expect(w.startIndex).toBe(0)
    expect(w.endIndex).toBe(50)
  })
})
